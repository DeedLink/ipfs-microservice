import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { pipeline } from "stream";
import { promisify } from "util";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// AWS S3 Client (v3)
const s3 = new S3Client({
  region: process.env.AWS_REGION || "",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME || "";

// Configure local storage
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  }),
});

// Upload endpoint
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const fileStream = fs.createReadStream(req.file.path);
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: req.file.filename,
        Body: fileStream,
        ACL: "private",
      })
    );

    // Return URL to fetch from backend
    const fileUrl = `/file/${req.file.filename}`;
    res.json({ hash: req.file.filename, url: fileUrl });
  } catch (err) {
    console.error("S3 upload error:", err);
    res.status(500).json({ error: "Failed to upload to S3" });
  }
});

// Fetch file endpoint
app.get("/file/:filename", async (req, res) => {
  const filename = req.params.filename;
  const localPath = path.join(process.cwd(), "uploads", filename);

  // Serve local file if exists
  if (fs.existsSync(localPath)) {
    return res.sendFile(localPath);
  }

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: filename,
    });

    const s3Object = await s3.send(command);
    if (!s3Object.Body) {
      return res.status(404).json({ error: "File not found" });
    }

    // Pipe S3 stream to response
    const streamPipeline = promisify(pipeline);
    await streamPipeline(s3Object.Body, res);
  } catch (err) {
    console.error("S3 fetch error:", err);
    res.status(500).json({ error: "Failed to fetch file from S3" });
  }
});

app.listen(PORT, () => {
  console.log(`IPFS-like microservice running at http://localhost:${PORT}`);
});
