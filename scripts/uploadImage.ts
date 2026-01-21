/**
 * One-time script to upload static images to Cloudinary
 * 
 * Usage:
 * 1. Put your image file in the scripts/ folder
 * 2. Run: npx ts-node scripts/uploadImage.ts <filename>
 * 
 * Example:
 * npx ts-node scripts/uploadImage.ts price_table.jpg
 */

import { v2 as cloudinary } from "cloudinary";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadImage(filename: string): Promise<void> {
  const filePath = path.join(__dirname, filename);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    console.log("\nMake sure to put your image file in the scripts/ folder");
    process.exit(1);
  }

  // Validate Cloudinary credentials
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error("❌ Missing Cloudinary credentials in .env file");
    console.log("\nRequired variables:");
    console.log("  CLOUDINARY_CLOUD_NAME");
    console.log("  CLOUDINARY_API_KEY");
    console.log("  CLOUDINARY_API_SECRET");
    process.exit(1);
  }

  console.log(`📤 Uploading ${filename} to Cloudinary...`);

  try {
    // Extract key from filename (without extension)
    const key = path.basename(filename, path.extname(filename));

    const result = await cloudinary.uploader.upload(filePath, {
      folder: "maashrim_static", // Separate folder for static images
      public_id: key,
      overwrite: true,
      resource_type: "image",
    });

    console.log("\n✅ Upload successful!");
    console.log("\n📋 Copy this URL to imageCatalog.ts:");
    console.log(`\n   url: "${result.secure_url}"\n`);
    console.log("Full response:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("❌ Upload failed:", error);
    process.exit(1);
  }
}

// Get filename from command line args
const filename = process.argv[2];

if (!filename) {
  console.log("Usage: npx ts-node scripts/uploadImage.ts <filename>");
  console.log("Example: npx ts-node scripts/uploadImage.ts price_table.jpg");
  process.exit(1);
}

void uploadImage(filename);

