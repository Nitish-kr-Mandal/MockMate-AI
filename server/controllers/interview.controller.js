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
import User from "../models/user.model.js";
import Interview from "../models/interview.model.js";
import { time } from "console";

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

export const generateQuestion = async (req, res) => {
  try {
    let { role, experience, mode, resumeText, projects, skills } = req.body;

    role = role?.trim();
    experience = experience?.trim();
    mode = mode?.trim();

    if (!role || !experience || !mode) {
      return res
        .status(400)
        .json({ message: "Role, experience and mode are required" });
    }

    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    if (user.credits < 50) {
      return res
        .status(400)
        .json({ message: "Not enough credits. Minimum 50 required" });
    }

    const projectText =
      Array.isArray(projects) && projects.length ? projects.join(", ") : "None";

    const skillsText =
      Array.isArray(skills) && skills.length ? skills.join(", ") : "None";

    const saferesume = resumeText?.trim() || "None";

    const userPrompt = `
    Role:${role}
    Experience:${experience}
    InterviewMode:${mode}
    Projects:${projectText}
    Skills:${skillsText},
    Resume:${saferesume}`;

    if (!userPrompt.trim()) {
      return res.status(400).json({ message: "Prompt content is empty" });
    }

    const messages = [
      {
        role: "system",
        content: `
        You are a real human interviewer conducting a professional interview.

        Speak in simple, natural English as if you are directly talking to the candidate.

        Generate exactly 5 interview questions.

        Strict Rules:
        - Each question must contain between 15 and 30 words.
        - Each question must be a single complete sentence.
        - Do NOT number them.
        - Do NOT add explanations.
        - Do NOT add extra text before or after.
        - One question per line only.
        - Keep language simple and conversational.
        - Question must feel practical and realistic.

        Difficulty progression:
        Question 1 -> easy
        Question 2 -> easy
        Question 3 -> medium
        Question 4 -> medium
        Question 5 -> hard

        Make questions based on the candidate's role, experience, interviewMode, projects, skills, and resume details.        
        `,
      },

      {
        role: "user",
        content: userPrompt,
      },
    ];

    const aiResponse = await askAi(messages);

    if (!aiResponse || !aiResponse.trim()) {
      return res.status(500).json({ message: "AI returned empty response." });
    }

    const questionsArray = aiResponse
      .split("\n")
      .map((q) => q.trim())
      .filter((q) => q.length > 0)
      .slice(0, 5);

    if (questionsArray.length === 0) {
      return res
        .status(500)
        .json({ message: "AI failed to generate questions." });
    }

    user.credits -= 50;

    await user.save();

    const interview = await Interview.create({
      userId: user._id,
      role,
      experience,
      mode,
      resumeText: saferesume,
      questions: questionsArray.map((q, index) => ({
        question: q,
        difficulty: ["easy", "easy", "medium", "medium", "hard"][index],
        timeLimit: [60, 60, 90, 90, 120][index],
      })),
    });

    res.json({
      interviewId: interview._id,
      creditsLeft: user.credits,
      userName: user.name,
      questions: interview.questions,
    });
  } catch (error) {
    return res.status(500).json({message: `Failed to create interview ${error}`})  }
};

export const submitAnswer = async (req, res) => {
  try {
    const { interviewId, questionIndex, answer, timeTaken } = req.body;

    const interview = await Interview.findById(interviewId);
    const question = interview.questions[questionIndex];

    // If no answer
    if (!answer) {
      question.score = 0;
      question.feedback = "You did not submit an answer.";
      question.answer = "";

      await interview.save();

      return res.json({
        feedback: question.feedback,
      });
    }

    // If time exceeded
    if (timeTaken > question.timeLimit) {
      question.score = 0;
      question.feedback = "Time limit exceeded. Answer not evaluated.";
      question.answer = answer;

      await interview.save();

      return res.json({
        feedback: question.feedback,
      });
    }

    const messages = [
      {
        role: "system",
        content: `
You are a professional human interviewer evaluating a candidate's answer in a real interview.

Evaluate naturally and fairly, like a real person would.

Score the answer in these areas (0 to 10):

1. Confidence - Does the answer sound clear, confident, and well-presented?
2. Communication - Is the language simple, clear, and easy to understand?
3. Correctness - Is the answer accurate, relevant, and complete?

Rules:
- Be realistic and unbiased.
- Do not give random high scores.
- If the answer is weak, score low.
- If the answer is strong and detailed, score high.
- Consider clarity, structure, and relevance.

Calculate:
finalScore = average of confidence, communication, and correctness (rounded to nearest whole number).

Feedback Rules:
- Write natural human feedback.
- 10 to 50 words only.
- Sound like real interview feedback.
- Can suggest improvement if needed.
- Do NOT repeat the question.
- Do NOT explain scoring.
- Keep tone professional and honest.

Return ONLY valid JSON in this format:

{
  "confidence": number,
  "communication": number,
  "correctness": number,
  "finalScore": number,
  "feedback": "short human feedback"
}
`
  },
      {
        role: "user",
        content: `
Question: ${question.question}
Answer: ${answer}
`
      }
    ];

    const aiResponse = await askAi(messages)

    const parsed = JSON.parse(aiResponse)

    question.answer = answer;
    question.confidence = parsed.confidence;
    question.communication = parsed.communication;
    question.correctness = parsed.correctness;
    question.score = parsed.finalScore;
    question.feedback = parsed.feedback;

    await interview.save()

    return res.status(200).json({feedback: parsed.feedback})

  } catch (error) {
    return res.status(500).json({message: `Failed to submit answer ${error}`})
  }
}


export const finishInterview = async (req, res) => {
  try {
    const {interviewId} = req.body
    const interview = await Interview.findById(interviewId)

    if(!interview){
      return res.status(400).json({message:"failed to find Interview"})
    }

    const totalQuestions = interview.questions.length;

    let totalScore = 0;
    let totalConfidence = 0;
    let totalCommunication = 0;
    let totalCorrectness = 0;

    interview.questions.forEach((q) => {
      totalScore += q.score || 0;
      totalConfidence += q.confidence || 0;
      totalCommunication += q.communication || 0;
      totalCorrectness += q.correctness || 0;
    })

    const finalScore = totalQuestions? totalScore/totalQuestions : 0;

    const avgConfidence = totalQuestions? totalConfidence/totalQuestions : 0;

    const avgCommunication = totalQuestions? totalCommunication/totalQuestions : 0;

    const avgCorrectness = totalQuestions? totalCorrectness/totalQuestions : 0;

    interview.finalScore = finalScore;
    interview.status = "Completed"

    await interview.save()

    return res.status(200).json({
      finalScore: Number(finalScore.toFixed(1)),
      confidence: Number(avgConfidence.toFixed(1)),
      communication: Number(avgCommunication.toFixed(1)),
      correctness: Number(avgCorrectness.toFixed(1)),
      questionWiseScore: interview.questions.map((q) => ({
        question: q.question,
        score: q.score || 0,
        feedback: q.feedback || "",
        confidence: q.confidence || 0,
        communication: q.communication || 0,
        correctness: q.correctness || 0
      }))
    })

  } catch (error) {
     return res.status(500).json({message: `Failed to finish Interview ${error}`})
  }
}


export const getMyInterviews = async (req, res) => {
  try {
    const interviews = await Interview.find({userId:req.userId})
    .sort({createdAt: -1})
    .select("role experience mode finalScore status createdAt");

    return res.status(200).json(interviews) 

  } catch (error) {
     return res.status(500).json({message: `Failed to find currentUser  Interview ${error}`})
  }
}


export const getInterviewReport = async (req, res) => {
  try {
    const interview = await interview.findById(req.params.id)

    if(!interview){
      return res.status(404).json({message: "Interview not found"})
    }

    const totalQuestions = interview.questions.length;

    let totalConfidence = 0;
    let totalCommunication = 0;
    let totalCorrectness = 0;

    interview.questions.forEach((q) => {
      totalConfidence += q.confidence || 0;
      totalCommunication += q.communication || 0;
      totalCorrectness += q.correctness || 0;
    })

    const avgConfidence = totalQuestions? totalConfidence/totalQuestions : 0;

    const avgCommunication = totalQuestions? totalCommunication/totalQuestions : 0;

    const avgCorrectness = totalQuestions? totalCorrectness/totalQuestions : 0;

    return res.json({
      finalScore: interview.finalScore,
      confidence: Number(avgConfidence.toFixed(1)),
      communication: Number(avgCommunication.toFixed(1)),
      correctness: Number(avgCorrectness.toFixed(1)),
      questionWiseScore: interview.questions
    })
    
  } catch (error) {
     return res.status(500).json({message: `Failed to find currentUser  Interview report ${error}`})
  }
}
