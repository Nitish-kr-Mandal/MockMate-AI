import fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";


import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";


const __dirname = dirname(fileURLToPath(import.meta.url));
const workerPath = new URL(
  "../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url,
);
pdfjs.GlobalWorkerOptions.workerSrc = workerPath.href;

import { askAi } from "../services/openRouter.services.js";


async function extractTextFromPdf(pdf) {
  let fullText = "";
  const extractionStats = {
    pagesRead: 0,
    pageErrors: 0,
    totalText: 0,
  };

  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);

       
        const textContent = await page.getTextContent({
          includeMarkedContent: true,
          normalizeSpaces: true,
        });

        if (textContent && textContent.items) {
          const pageText = textContent.items
            .map((item) => {
              if (typeof item === "string") return item;
              if (item.str) return item.str.trim();
              return "";
            })
            .filter((str) => str && str.length > 0)
            .join(" ");

          if (pageText) {
            fullText += pageText + "\n";
            extractionStats.totalText += pageText.length;
          }
          extractionStats.pagesRead++;
        }
      } catch (pageError) {
        console.warn(
          `Warning: Failed to extract text from page ${pageNum}: ${pageError.message}`,
        );
        extractionStats.pageErrors++;
        fullText += "[Text extraction from this page failed]\n";
      }
    }

    console.log(
      `PDF extraction stats: ${extractionStats.pagesRead} pages read, ${extractionStats.pageErrors} errors, ${extractionStats.totalText} chars extracted`,
    );

    if (fullText.trim().length === 0) {
      throw new Error(
        "No text content could be extracted from the PDF. The file may be image-based or encrypted.",
      );
    }
  } catch (error) {
    console.error("PDF text extraction error:", error.message);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }

  return fullText;
}

export const analyzeResume = async (req, res) => {
  let filepath = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        message: "Resume file is required",
        code: "NO_FILE",
      });
    }

    filepath = req.file.path;
    console.log(
      `Processing resume file: ${req.file.originalname} (${req.file.size} bytes)`,
    );

    const fileBuffer = await fs.promises.readFile(filepath);
    console.log(`Read file buffer: ${fileBuffer.length} bytes`);

    const uint8Array = new Uint8Array(
      fileBuffer.buffer,
      fileBuffer.byteOffset,
      fileBuffer.length,
    );

    const pdfOptions = {
      data: uint8Array,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
      cMapUrl: undefined,
      rangeChunkSize: 65536,
    };

    console.log("Initializing PDF.js with Node.js options...");
    const pdf = await pdfjs.getDocument(pdfOptions).promise;
    console.log(`PDF loaded successfully: ${pdf.numPages} pages`);

    console.log("Starting text extraction...");
    const resumeText = await extractTextFromPdf(pdf);

    const normalizedText = resumeText.replace(/\s+/g, " ").trim();

    console.log(
      `Text extraction complete: ${normalizedText.length} characters`,
    );

    if (normalizedText.length < 10) {
      return res.status(400).json({
        message:
          "Could not extract sufficient text from PDF. The file may be invalid or contain no readable text.",
        code: "INSUFFICIENT_TEXT",
      });
    }

    // Prepare messages for AI analysis
    const messages = [
      {
        role: "system",
        content: `You are an expert resume analyzer. Extract structured data from the resume text provided.

Return ONLY valid JSON with this exact structure (no markdown, no extra text):
{
    "role": "the job title or role (string)",
    "experience": "years of experience (string, e.g., '5 years' or 'Senior level')",
    "projects": ["project1 name", "project2 name", "project3 name"],
    "skills": ["skill1", "skill2", "skill3", "skill4", "skill5", "...all skills found"]
}
Rules:
Extract the PRIMARY and CORE skills from the resume.
Follow these rules for skills extraction:
- Skip minor tools, utilities, plugins, or libraries that support a main skill (e.g., skip "Axios" if "React" is present)
- Remove duplicates and standardize names 
- Exclude soft skills like "communication", "teamwork", "leadership", "problem-solving"
- Exclude generic tools like "Git", "VS Code", "Postman", "Microsoft Office"


If information is not available, use empty strings or empty arrays.`,
      },
      {
        role: "user",
        content: `Analyze this resume:\n\n${normalizedText}`,
      },
    ];

    console.log("Sending to AI for analysis...");
    const aiResponse = await askAi(messages);
    console.log(`AI response received: ${aiResponse.length} characters`);

    // Parse AI response
    let parsed;
    try {
      parsed = JSON.parse(aiResponse);
      console.log("AI response parsed successfully");
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError.message);
      console.error("AI response was:", aiResponse);
      if (filepath && fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      return res.status(400).json({
        message:
          "Failed to parse AI response. The AI may have returned invalid JSON.",
        code: "AI_PARSE_ERROR",
      });
    }

    fs.unlinkSync(filepath);

    console.log(
      `Analysis complete. Returning: role=${parsed.role}, experience=${parsed.experience}, ${parsed.skills?.length || 0} skills`,
    );

    res.json({
      success: true,
      role: parsed.role || "",
      experience: parsed.experience || "",
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      resumeText: normalizedText,
    });
  } catch (error) {
    console.error("Resume analysis error:", {
      message: error.message,
      stack: error.stack,
      code: error.code,
    });

    // Clean up uploaded file
    if (filepath && fs.existsSync(filepath)) {
      try {
        fs.unlinkSync(filepath);
        console.log("Temporary file cleaned up");
      } catch (cleanupError) {
        console.error(
          "Failed to clean up temporary file:",
          cleanupError.message,
        );
      }
    }


    if (
      error.message?.includes("DOMMatrix") ||
      error.message?.includes("Path2D") ||
      error.message?.includes("ImageData")
    ) {
      return res.status(400).json({
        message:
          "PDF format not supported. This file may be corrupted or use unsupported compression. Please try a different PDF file.",
        code: "UNSUPPORTED_PDF_FORMAT",
      });
    }

    // Invalid PDF structure
    if (
      error.message?.includes("Invalid PDF") ||
      error.message?.includes("PDF signature") ||
      error.message?.includes("header")
    ) {
      return res.status(400).json({
        message:
          "The file is not a valid PDF. Please ensure you uploaded a genuine PDF document.",
        code: "INVALID_PDF",
      });
    }

    // Text extraction failed
    if (
      error.message?.includes("extract text") ||
      error.message?.includes("No text content")
    ) {
      return res.status(400).json({
        message:
          "Unable to extract text from PDF. The file may be image-based, encrypted, or corrupted.",
        code: "TEXT_EXTRACTION_FAILED",
      });
    }

    // OpenRouter AI service errors
    if (
      error.message?.includes("AI") ||
      error.message?.includes("OpenRouter") ||
      error.message?.includes("API Error")
    ) {
      return res.status(503).json({
        message:
          "AI service is temporarily unavailable. Please try again in a few moments.",
        code: "AI_SERVICE_ERROR",
      });
    }

    // Catch-all error response
    return res.status(500).json({
      message:
        "Failed to analyze resume. Please ensure it's a valid, readable PDF file and try again.",
      code: "ANALYSIS_FAILED",
      error: error.message,
    });
  }
};
