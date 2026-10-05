package com.patstechnologies.patsxpdf;

public record TextFragment(
    String text,
    float x,
    float y,
    float width,
    float height,
    String source,
    Float confidence
) {}
