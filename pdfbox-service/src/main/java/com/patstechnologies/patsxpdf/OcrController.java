package com.patstechnologies.patsxpdf;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.util.Map;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.NOT_FOUND;
import static org.springframework.http.HttpStatus.UNAUTHORIZED;

@RestController
@RequestMapping
public class OcrController {
    private final OcrService ocrService;
    private final String apiToken;

    public OcrController(OcrService ocrService, @Value("${pdfbox.api-token}") String apiToken) {
        this.ocrService = ocrService;
        this.apiToken = apiToken;
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }

    @PostMapping(path = "/v1/ocr/page", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> page(
        @RequestHeader("X-API-Token") String token,
        @RequestParam UUID jobId,
        @RequestParam int page,
        @RequestParam(defaultValue = "por+eng+spa+fra") String languages,
        @RequestParam MultipartFile file
    ) throws IOException {
        authorize(token);
        OcrJob job = ocrService.processPage(jobId, file, page, languages);
        String text = Files.readString(ocrService.getResult(jobId, "result.txt"));
        return Map.of("job", job, "text", text);
    }

    @PostMapping(path = "/v1/ocr/jobs", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<OcrJob> submit(
        @RequestHeader("X-API-Token") String token,
        @RequestParam UUID jobId,
        @RequestParam(defaultValue = "por+eng+spa+fra") String languages,
        @RequestParam MultipartFile file
    ) throws IOException {
        authorize(token);
        return ResponseEntity.accepted().body(ocrService.submitFull(jobId, file, languages));
    }

    @PostMapping(path = "/v1/extractions/page", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> extractPage(
        @RequestHeader("X-API-Token") String token,
        @RequestParam UUID jobId,
        @RequestParam int page,
        @RequestParam(defaultValue = "por+eng+spa+fra") String languages,
        @RequestParam MultipartFile file
    ) throws IOException {
        authorize(token);
        OcrJob job = ocrService.extractPage(jobId, file, page, languages);
        return Map.of(
            "job", job,
            "text", Files.readString(ocrService.getResult(jobId, "result.txt")),
            "json", Files.readString(ocrService.getResult(jobId, "result.json"))
        );
    }

    @PostMapping(path = "/v1/extractions/jobs", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<OcrJob> submitExtraction(
        @RequestHeader("X-API-Token") String token,
        @RequestParam UUID jobId,
        @RequestParam String pages,
        @RequestParam(defaultValue = "por+eng+spa+fra") String languages,
        @RequestParam MultipartFile file
    ) throws IOException {
        authorize(token);
        List<Integer> requestedPages = Arrays.stream(pages.split(",")).map(String::strip).map(Integer::valueOf).distinct().sorted().toList();
        return ResponseEntity.accepted().body(ocrService.submitExtraction(jobId, file, requestedPages, languages));
    }

    @GetMapping("/v1/ocr/jobs/{jobId}")
    public OcrJob status(@RequestHeader("X-API-Token") String token, @PathVariable UUID jobId) throws IOException {
        authorize(token);
        return ocrService.getJob(jobId);
    }

    @GetMapping("/v1/ocr/jobs/{jobId}/text")
    public ResponseEntity<FileSystemResource> text(@RequestHeader("X-API-Token") String token, @PathVariable UUID jobId) throws IOException {
        authorize(token);
        return ResponseEntity.ok()
            .contentType(MediaType.TEXT_PLAIN)
            .body(new FileSystemResource(ocrService.getResult(jobId, "result.txt")));
    }

    @GetMapping("/v1/ocr/jobs/{jobId}/pdf")
    public ResponseEntity<FileSystemResource> pdf(@RequestHeader("X-API-Token") String token, @PathVariable UUID jobId) throws IOException {
        authorize(token);
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_PDF)
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"ocr-" + jobId + ".pdf\"")
            .body(new FileSystemResource(ocrService.getResult(jobId, "result.pdf")));
    }

    @GetMapping("/v1/ocr/jobs/{jobId}/json")
    public ResponseEntity<FileSystemResource> json(@RequestHeader("X-API-Token") String token, @PathVariable UUID jobId) throws IOException {
        authorize(token);
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_JSON)
            .body(new FileSystemResource(ocrService.getResult(jobId, "result.json")));
    }

    @ExceptionHandler(OcrService.JobNotFoundException.class)
    public ResponseEntity<Map<String, String>> notFound(OcrService.JobNotFoundException error) {
        return ResponseEntity.status(NOT_FOUND).body(Map.of("error", error.getMessage()));
    }

    @ExceptionHandler({IllegalArgumentException.class, IllegalStateException.class})
    public ResponseEntity<Map<String, String>> invalid(RuntimeException error) {
        return ResponseEntity.status(BAD_REQUEST).body(Map.of("error", error.getMessage()));
    }

    private void authorize(String token) {
        if (!apiToken.equals(token)) throw new ResponseStatusException(UNAUTHORIZED);
    }
}
