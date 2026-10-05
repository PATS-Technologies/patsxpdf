FROM maven:3.9.11-eclipse-temurin-21 AS builder
WORKDIR /build
COPY pom.xml .
RUN mvn -B dependency:go-offline
COPY src ./src
RUN mvn -B package -DskipTests

FROM eclipse-temurin:21-jre-noble
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      curl \
      tesseract-ocr \
      tesseract-ocr-eng \
      tesseract-ocr-fra \
      tesseract-ocr-por \
      tesseract-ocr-spa \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN groupadd --system --gid 1001 pdfbox \
    && useradd --system --uid 1001 --gid pdfbox --shell /usr/sbin/nologin pdfbox \
    && mkdir -p /data/jobs \
    && chown -R pdfbox:pdfbox /data
COPY --from=builder --chown=pdfbox:pdfbox /build/target/patsxpdf-pdfbox-0.1.0.jar /app/service.jar
USER pdfbox
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/service.jar"]
