package com.patstechnologies.patsxpdf;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.multipdf.PDFMergerUtility;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@Service
public class OcrService {
    private static final Set<String> SUPPORTED_LANGUAGES = Set.of("por", "eng", "spa", "fra");

    private final Path jobsPath;
    private final int dpi;
    private final int pageTimeoutSeconds;
    private final ObjectMapper objectMapper;
    private final ExecutorService executor;

    public OcrService(
        @Value("${pdfbox.jobs-path}") String jobsPath,
        @Value("${pdfbox.dpi}") int dpi,
        @Value("${pdfbox.workers}") int workers,
        @Value("${pdfbox.tesseract-timeout-seconds}") int pageTimeoutSeconds,
        ObjectMapper objectMapper
    ) {
        this.jobsPath = Path.of(jobsPath).toAbsolutePath().normalize();
        this.dpi = dpi;
        this.pageTimeoutSeconds = pageTimeoutSeconds;
        this.objectMapper = objectMapper;
        this.executor = Executors.newFixedThreadPool(Math.max(1, workers));
    }

    @PostConstruct
    void initialize() throws IOException {
        Files.createDirectories(jobsPath);
        try (var directories = Files.list(jobsPath)) {
            for (Path directory : directories.filter(Files::isDirectory).toList()) {
                Path metadata = directory.resolve("job.json");
                if (!Files.isRegularFile(metadata)) continue;
                OcrJob job = objectMapper.readValue(metadata.toFile(), OcrJob.class);
                if (job.status() == OcrJob.Status.QUEUED || job.status() == OcrJob.Status.PROCESSING) {
                    writeJob(job.withProgress(OcrJob.Status.ERROR, job.totalPages(), job.processedPages(),
                        "The OCR service restarted before the task completed.", Instant.now()));
                }
            }
        }
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }

    public OcrJob processPage(UUID jobId, MultipartFile file, int page, String languages) throws IOException {
        String normalizedLanguages = validateLanguages(languages);
        Path jobDirectory = createJobDirectory(jobId);
        Path source = jobDirectory.resolve("source.pdf");
        file.transferTo(source);
        OcrJob job = new OcrJob(jobId, OcrJob.Status.PROCESSING, "page", normalizedLanguages, page, 0, 0, null, Instant.now(), null);
        writeJob(job);
        try (PDDocument document = Loader.loadPDF(source.toFile())) {
            if (page < 1 || page > document.getNumberOfPages()) {
                throw new IllegalArgumentException("Page must be between 1 and " + document.getNumberOfPages() + ".");
            }
            OcrPageResult result = recognizePage(document, page - 1, normalizedLanguages, jobDirectory.resolve("work"));
            Files.move(result.pdf(), jobDirectory.resolve("result.pdf"), StandardCopyOption.REPLACE_EXISTING);
            Files.writeString(jobDirectory.resolve("result.txt"), result.text(), StandardCharsets.UTF_8);
            OcrJob completed = job.withProgress(OcrJob.Status.COMPLETED, document.getNumberOfPages(), 1, null, Instant.now());
            writeJob(completed);
            Files.deleteIfExists(source);
            deleteDirectory(jobDirectory.resolve("work"));
            return completed;
        } catch (RuntimeException | IOException error) {
            writeJob(job.withProgress(OcrJob.Status.ERROR, job.totalPages(), 0, error.getMessage(), Instant.now()));
            throw error;
        }
    }

    public OcrJob submitFull(UUID jobId, MultipartFile file, String languages) throws IOException {
        String normalizedLanguages = validateLanguages(languages);
        Path jobDirectory = createJobDirectory(jobId);
        file.transferTo(jobDirectory.resolve("source.pdf"));
        OcrJob job = new OcrJob(jobId, OcrJob.Status.QUEUED, "full", normalizedLanguages, null, 0, 0, null, Instant.now(), null);
        writeJob(job);
        executor.submit(() -> processFull(job));
        return job;
    }

    public OcrJob extractPage(UUID jobId, MultipartFile file, int page, String languages) throws IOException {
        String normalizedLanguages = validateLanguages(languages);
        Path jobDirectory = createJobDirectory(jobId);
        Path source = jobDirectory.resolve("source.pdf");
        file.transferTo(source);
        OcrJob job = new OcrJob(jobId, OcrJob.Status.PROCESSING, "extract", normalizedLanguages, page, 1, 0, null, Instant.now(), null);
        writeJob(job);
        try (PDDocument document = Loader.loadPDF(source.toFile())) {
            validatePages(List.of(page), document.getNumberOfPages());
            ExtractionPage result = extractHybridPage(document, page - 1, normalizedLanguages, jobDirectory.resolve("work"));
            writeExtractionArtifacts(jobDirectory, List.of(result));
            OcrJob completed = job.withProgress(OcrJob.Status.COMPLETED, 1, 1, null, Instant.now());
            writeJob(completed);
            Files.deleteIfExists(source);
            deleteDirectory(jobDirectory.resolve("work"));
            return completed;
        } catch (RuntimeException | IOException error) {
            writeJob(job.withProgress(OcrJob.Status.ERROR, 1, 0, error.getMessage(), Instant.now()));
            throw error;
        }
    }

    public OcrJob submitExtraction(UUID jobId, MultipartFile file, List<Integer> pages, String languages) throws IOException {
        String normalizedLanguages = validateLanguages(languages);
        Path jobDirectory = createJobDirectory(jobId);
        file.transferTo(jobDirectory.resolve("source.pdf"));
        Files.writeString(jobDirectory.resolve("pages.txt"), pages.stream().map(String::valueOf).collect(java.util.stream.Collectors.joining(",")));
        OcrJob job = new OcrJob(jobId, OcrJob.Status.QUEUED, "extract", normalizedLanguages, null, pages.size(), 0, null, Instant.now(), null);
        writeJob(job);
        executor.submit(() -> processExtraction(job, pages));
        return job;
    }

    public OcrJob getJob(UUID jobId) throws IOException {
        Path metadata = resolveJobPath(jobId, "job.json");
        if (!Files.isRegularFile(metadata)) throw new JobNotFoundException(jobId);
        return objectMapper.readValue(metadata.toFile(), OcrJob.class);
    }

    public Path getResult(UUID jobId, String filename) throws IOException {
        OcrJob job = getJob(jobId);
        if (job.status() != OcrJob.Status.COMPLETED) {
            throw new IllegalStateException("OCR task is not complete.");
        }
        Path result = resolveJobPath(jobId, filename);
        if (!Files.isRegularFile(result)) throw new JobNotFoundException(jobId);
        return result;
    }

    private void processFull(OcrJob initialJob) {
        Path jobDirectory = jobsPath.resolve(initialJob.id().toString());
        Path source = jobDirectory.resolve("source.pdf");
        Path work = jobDirectory.resolve("work");
        OcrJob current = initialJob.withProgress(OcrJob.Status.PROCESSING, 0, 0, null, null);
        try {
            writeJob(current);
            Files.createDirectories(work);
            try (PDDocument document = Loader.loadPDF(source.toFile())) {
                int totalPages = document.getNumberOfPages();
                current = current.withProgress(OcrJob.Status.PROCESSING, totalPages, 0, null, null);
                writeJob(current);
                PDFMergerUtility merger = new PDFMergerUtility();
                Path resultPdf = jobDirectory.resolve("result.pdf");
                merger.setDestinationFileName(resultPdf.toString());
                StringBuilder text = new StringBuilder();
                for (int index = 0; index < totalPages; index++) {
                    Path pageWork = work.resolve("page-" + (index + 1));
                    OcrPageResult result = recognizePage(document, index, initialJob.languages(), pageWork);
                    merger.addSource(result.pdf().toFile());
                    if (!text.isEmpty()) text.append("\n\n\f\n\n");
                    text.append(result.text());
                    current = current.withProgress(OcrJob.Status.PROCESSING, totalPages, index + 1, null, null);
                    writeJob(current);
                }

                merger.mergeDocuments(null);
                Files.writeString(jobDirectory.resolve("result.txt"), text, StandardCharsets.UTF_8);
                current = current.withProgress(OcrJob.Status.COMPLETED, totalPages, totalPages, null, Instant.now());
                writeJob(current);
            }
            Files.deleteIfExists(source);
            deleteDirectory(work);
        } catch (Exception error) {
            try {
                writeJob(current.withProgress(OcrJob.Status.ERROR, current.totalPages(), current.processedPages(),
                    error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage(), Instant.now()));
            } catch (IOException persistenceError) {
                error.addSuppressed(persistenceError);
            }
        }
    }

    private void processExtraction(OcrJob initialJob, List<Integer> pages) {
                Path jobDirectory = jobsPath.resolve(initialJob.id().toString());
                Path source = jobDirectory.resolve("source.pdf");
                Path work = jobDirectory.resolve("work");
                OcrJob current = initialJob.withProgress(OcrJob.Status.PROCESSING, pages.size(), 0, null, null);
                try {
                    writeJob(current);
                    Files.createDirectories(work);
                    try (PDDocument document = Loader.loadPDF(source.toFile())) {
                        validatePages(pages, document.getNumberOfPages());
                        List<ExtractionPage> results = new ArrayList<>();
                        for (int index = 0; index < pages.size(); index++) {
                            int page = pages.get(index);
                            results.add(extractHybridPage(document, page - 1, initialJob.languages(), work.resolve("page-" + page)));
                            current = current.withProgress(OcrJob.Status.PROCESSING, pages.size(), index + 1, null, null);
                            writeJob(current);
                        }
                        writeExtractionArtifacts(jobDirectory, results);
                        current = current.withProgress(OcrJob.Status.COMPLETED, pages.size(), pages.size(), null, Instant.now());
                        writeJob(current);
                    }
                    Files.deleteIfExists(source);
                    deleteDirectory(work);
                } catch (Exception error) {
                    try {
                        writeJob(current.withProgress(OcrJob.Status.ERROR, pages.size(), current.processedPages(),
                            error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage(), Instant.now()));
                    } catch (IOException persistenceError) {
                        error.addSuppressed(persistenceError);
                    }
                }
            }

    private ExtractionPage extractHybridPage(PDDocument document, int pageIndex, String languages, Path workDirectory) throws IOException {
                Files.createDirectories(workDirectory);
                var page = document.getPage(pageIndex);
                float pageWidth = page.getCropBox().getWidth();
                float pageHeight = page.getCropBox().getHeight();
                List<TextFragment> nativeFragments = new NativeTextExtractor().extract(document, pageIndex + 1);
                BufferedImage image = new PDFRenderer(document).renderImageWithDPI(pageIndex, dpi, ImageType.RGB);
                Graphics2D graphics = image.createGraphics();
                graphics.setColor(Color.WHITE);
                float scale = dpi / 72f;
                for (TextFragment fragment : nativeFragments) {
                    int padding = Math.max(8, Math.round(fragment.height() * scale * 0.3f));
                    int x = Math.max(0, Math.round(fragment.x() * scale) - padding);
                    int y = Math.max(0, Math.round(fragment.y() * scale) - padding);
                    int width = Math.min(image.getWidth() - x, Math.round(fragment.width() * scale) + padding * 2);
                    int height = Math.min(image.getHeight() - y, Math.round(fragment.height() * scale) + padding * 2);
                    graphics.fillRect(x, y, Math.max(1, width), Math.max(1, height));
                }
                graphics.dispose();
                List<TextFragment> ocrFragments = recognizePositionedText(image, languages, workDirectory, scale);
                List<TextFragment> combined = new ArrayList<>(nativeFragments);
                combined.addAll(ocrFragments);
                combined.sort(Comparator.comparing(TextFragment::y).thenComparing(TextFragment::x));
                return new ExtractionPage(pageIndex + 1, pageWidth, pageHeight, !ocrFragments.isEmpty(), readingOrderText(combined), combined);
            }

    private List<TextFragment> recognizePositionedText(BufferedImage image, String languages, Path workDirectory, float scale) throws IOException {
                Path imagePath = workDirectory.resolve("masked-page.png");
                Path outputBase = workDirectory.resolve("positioned-ocr");
                if (!ImageIO.write(image, "png", imagePath.toFile())) throw new IOException("No PNG writer is available.");
                runTesseract(List.of("tesseract", imagePath.toString(), outputBase.toString(), "-l", languages, "tsv"), workDirectory);
                Path tsv = Path.of(outputBase + ".tsv");
                if (!Files.isRegularFile(tsv)) throw new IOException("Tesseract did not produce positional OCR data.");
                List<TextFragment> fragments = new ArrayList<>();
                for (String line : Files.readAllLines(tsv, StandardCharsets.UTF_8).stream().skip(1).toList()) {
                    String[] columns = line.split("\t", 12);
                    if (columns.length < 12 || columns[11].isBlank()) continue;
                    try {
                        float confidence = Float.parseFloat(columns[10]);
                        if (confidence < 50) continue;
                        fragments.add(new TextFragment(columns[11].strip(), Integer.parseInt(columns[6]) / scale,
                            Integer.parseInt(columns[7]) / scale, Integer.parseInt(columns[8]) / scale,
                            Integer.parseInt(columns[9]) / scale, "ocr", confidence));
                    } catch (NumberFormatException ignored) {
                        // Tesseract metadata rows do not always contain word-level numeric values.
                    }
                }
                return fragments;
            }

    private void runTesseract(List<String> command, Path workDirectory) throws IOException {
                Path processLog = workDirectory.resolve("tesseract.log");
                Process process = new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(processLog.toFile()).start();
                try {
                    if (!process.waitFor(pageTimeoutSeconds, TimeUnit.SECONDS)) {
                        process.destroyForcibly();
                        throw new IOException("Tesseract exceeded the per-page timeout.");
                    }
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    process.destroyForcibly();
                    throw new IOException("OCR processing was interrupted.", error);
                }
                String output = Files.readString(processLog, StandardCharsets.UTF_8);
                if (process.exitValue() != 0) throw new IOException("Tesseract failed: " + output.strip());
            }

    private String readingOrderText(List<TextFragment> fragments) {
                StringBuilder text = new StringBuilder();
                float currentBottom = -1;
                for (TextFragment fragment : fragments) {
                    if (!text.isEmpty()) {
                        float gap = fragment.y() - currentBottom;
                        text.append(gap > Math.max(4, fragment.height() * 0.6f) ? "\n" : " ");
                    }
                    text.append(fragment.text());
                    currentBottom = Math.max(currentBottom, fragment.y() + fragment.height());
                }
                return text.toString().strip();
            }

    private void writeExtractionArtifacts(Path jobDirectory, List<ExtractionPage> pages) throws IOException {
                String text = pages.stream().map(page -> "Page " + page.page() + "\n" + page.text())
                    .collect(java.util.stream.Collectors.joining("\n\n\f\n\n"));
                Files.writeString(jobDirectory.resolve("result.txt"), text, StandardCharsets.UTF_8);
                objectMapper.writeValue(jobDirectory.resolve("result.json").toFile(), Map.of("pages", pages));
            }

    private void validatePages(List<Integer> pages, int pageCount) {
                if (pages.isEmpty() || pages.stream().anyMatch(page -> page < 1 || page > pageCount)) {
                    throw new IllegalArgumentException("Requested pages must be between 1 and " + pageCount + ".");
                }
            }

    private OcrPageResult recognizePage(PDDocument document, int pageIndex, String languages, Path workDirectory) throws IOException {
        Files.createDirectories(workDirectory);
        Path imagePath = workDirectory.resolve("page.png");
        Path outputBase = workDirectory.resolve("ocr");
        BufferedImage image = new PDFRenderer(document).renderImageWithDPI(pageIndex, dpi, ImageType.RGB);
        if (!ImageIO.write(image, "png", imagePath.toFile())) {
            throw new IOException("No PNG writer is available.");
        }
        List<String> command = List.of(
            "tesseract",
            imagePath.toString(),
            outputBase.toString(),
            "-l",
            languages,
            "pdf",
            "txt"
        );
        runTesseract(command, workDirectory);
        Path pdf = Path.of(outputBase + ".pdf");
        Path text = Path.of(outputBase + ".txt");
        if (!Files.isRegularFile(pdf) || !Files.isRegularFile(text)) {
            throw new IOException("Tesseract did not produce the expected OCR artifacts.");
        }
        return new OcrPageResult(pdf, Files.readString(text, StandardCharsets.UTF_8).strip());
    }

    private String validateLanguages(String languages) {
        String normalized = languages == null || languages.isBlank() ? "por+eng+spa+fra" : languages.strip().toLowerCase();
        List<String> requested = List.of(normalized.split("\\+"));
        if (requested.isEmpty() || requested.stream().anyMatch(language -> !SUPPORTED_LANGUAGES.contains(language))) {
            throw new IllegalArgumentException("Supported OCR languages are por, eng, spa and fra.");
        }
        return String.join("+", requested.stream().distinct().toList());
    }

    private Path createJobDirectory(UUID jobId) throws IOException {
        Path directory = jobsPath.resolve(jobId.toString()).normalize();
        if (!directory.getParent().equals(jobsPath)) throw new IllegalArgumentException("Invalid job id.");
        Files.createDirectory(directory);
        return directory;
    }

    private Path resolveJobPath(UUID jobId, String filename) {
        Path path = jobsPath.resolve(jobId.toString()).resolve(filename).normalize();
        if (!path.startsWith(jobsPath)) throw new IllegalArgumentException("Invalid job path.");
        return path;
    }

    private synchronized void writeJob(OcrJob job) throws IOException {
        Path metadata = resolveJobPath(job.id(), "job.json");
        Path temporary = metadata.resolveSibling("job.json.tmp");
        objectMapper.writeValue(temporary.toFile(), job);
        Files.move(temporary, metadata, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private void deleteDirectory(Path directory) throws IOException {
        if (!Files.exists(directory)) return;
        try (var entries = Files.walk(directory)) {
            for (Path path : entries.sorted((left, right) -> right.compareTo(left)).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }

    private record OcrPageResult(Path pdf, String text) {}

    public static class JobNotFoundException extends RuntimeException {
        public JobNotFoundException(UUID jobId) {
            super("OCR task " + jobId + " was not found.");
        }
    }
}
