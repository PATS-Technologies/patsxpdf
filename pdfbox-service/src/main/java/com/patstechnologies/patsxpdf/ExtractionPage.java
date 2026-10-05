package com.patstechnologies.patsxpdf;

import java.util.List;

public record ExtractionPage(
    int page,
    float width,
    float height,
    boolean usedOcr,
    String text,
    List<TextFragment> fragments
) {}
