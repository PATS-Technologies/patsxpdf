package com.patstechnologies.patsxpdf;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public class NativeTextExtractor extends PDFTextStripper {
    private final List<TextFragment> fragments = new ArrayList<>();

    public NativeTextExtractor() throws IOException {
        setSortByPosition(true);
    }

    public List<TextFragment> extract(PDDocument document, int pageNumber) throws IOException {
        fragments.clear();
        setStartPage(pageNumber);
        setEndPage(pageNumber);
        getText(document);
        return List.copyOf(fragments);
    }

    @Override
    protected void writeString(String text, List<TextPosition> positions) {
        String normalized = text.strip();
        if (normalized.isEmpty() || positions.isEmpty()) return;
        float left = Float.MAX_VALUE;
        float top = Float.MAX_VALUE;
        float right = 0;
        float bottom = 0;
        for (TextPosition position : positions) {
            left = Math.min(left, position.getXDirAdj());
            top = Math.min(top, position.getYDirAdj() - position.getHeightDir());
            right = Math.max(right, position.getXDirAdj() + position.getWidthDirAdj());
            bottom = Math.max(bottom, position.getYDirAdj());
        }
        fragments.add(new TextFragment(normalized, left, top, right - left, bottom - top, "native", null));
    }
}
