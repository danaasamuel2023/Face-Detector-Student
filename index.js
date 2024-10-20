const express = require('express');
const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const { RekognitionClient, CompareFacesCommand } = require('@aws-sdk/client-rekognition');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const sharp = require('sharp');
const cors = require('cors');

// Configure MongoDB connection
const password = 'StudentMarket';
const uri = `mongodb+srv://StudentMarket:${password}@cluster0.ukbatl8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const mongoClient = new MongoClient(uri);

// Configure AWS SDK v3 clients
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: 'AKIAYQYUBEVQRBDJQGPW',
        secretAccessKey: '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',
    }
});

const rekognitionClient = new RekognitionClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: 'AKIAYQYUBEVQRBDJQGPW',
        secretAccessKey: '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',
    }
});

const app = express();
app.use(cors());
const bucketName = 'unimarketgh';

// Middleware to parse JSON request bodies
app.use(express.json());

// Multer middleware to handle image uploads temporarily (in memory)
const upload = multer({
    storage: multer.memoryStorage(), // Store images in memory
});

// Connect to MongoDB
mongoClient.connect()
    .then(() => {
        console.log("Connected to MongoDB");
    })
    .catch(err => console.error("MongoDB connection error:", err));

// Endpoint to upload, convert to JPG, compare, and find the best matching image
app.post('/upload', upload.single('image'), async (req, res) => {
    try {
        const uploadedImage = req.file;

        if (!uploadedImage) {
            return res.status(400).send({ message: 'Image upload failed' });
        }

        // Convert the uploaded image to JPG
        const convertedImageBuffer = await sharp(uploadedImage.buffer)
            .jpeg()
            .toBuffer();

        // List only images in the 'uploads' folder
        const listParams = {
            Bucket: bucketName,
            Prefix: 'uploads/', // Specify the prefix to filter for images in the uploads folder
        };

        const listCommand = new ListObjectsV2Command(listParams);
        const s3Objects = await s3Client.send(listCommand);

        if (!s3Objects.Contents || s3Objects.Contents.length === 0) {
            return res.status(404).send({ message: 'No images found in the uploads folder' });
        }

        let bestMatch = null;
        let highestSimilarity = 0;

        // Compare the converted image with each image in the uploads folder
        for (const item of s3Objects.Contents) {
            if (item.Key.includes(uploadedImage.originalname)) {
                console.log('Skipping comparison with itself:', uploadedImage.originalname);
                continue;
            }

            const compareParams = {
                SourceImage: {
                    Bytes: convertedImageBuffer
                },
                TargetImage: {
                    S3Object: {
                        Bucket: bucketName,
                        Name: item.Key
                    }
                },
                SimilarityThreshold: 80
            };

            const compareCommand = new CompareFacesCommand(compareParams);
            const response = await rekognitionClient.send(compareCommand);

            if (response.FaceMatches && response.FaceMatches.length > 0) {
                const similarity = response.FaceMatches[0].Similarity;
                if (similarity > highestSimilarity) {
                    highestSimilarity = similarity;
                    bestMatch = {
                        key: item.Key,
                        similarity: similarity
                    };
                }
            }
        }

        if (bestMatch) {
            // Retrieve user details from MongoDB based on the matching image key
            const db = mongoClient.db('FaceDectector');
            const collection = db.collection('imageMetadata');
            const userMetadata = await collection.findOne({ imageId: bestMatch.key });

            if (userMetadata) {
                res.status(200).send({
                    message: 'Best matching image found',
                    match: bestMatch,
                    user: {
                        username: userMetadata.username,
                        indexNumber: userMetadata.indexNumber,
                        timestamp: userMetadata.timestamp
                    }
                });
            } else {
                res.status(404).send({ message: 'No user details found for the matching image' });
            }
        } else {
            res.status(404).send({ message: 'No matching images found' });
        }
    } catch (error) {
        console.error('Error comparing images:', error);
        res.status(500).send({ message: 'Error comparing images', error });
    }
});

// New endpoint to store the uploaded image as JPG and metadata in MongoDB
app.post('/store', upload.single('image'), async (req, res) => {
    try {
        const uploadedImage = req.file;
        const { username, indexNumber } = req.body;

        if (!uploadedImage || !username || !indexNumber) {
            return res.status(400).send({ message: 'Missing image, username, or index number' });
        }

        // Convert the image to JPG
        const convertedImageBuffer = await sharp(uploadedImage.buffer)
            .jpeg()
            .toBuffer();

        // Upload the JPG image to S3
        const s3Key = `uploads/${uploadedImage.originalname.replace(/\.[^/.]+$/, ".jpg")}`;
        const uploadParams = {
            Bucket: bucketName,
            Key: s3Key,
            Body: convertedImageBuffer,
            ContentType: 'image/jpeg'
        };

        await s3Client.send(new PutObjectCommand(uploadParams));

        // Store metadata in MongoDB
        const metadata = {
            imageId: s3Key,
            username: username,
            indexNumber: indexNumber,
            timestamp: new Date()
        };

        const db = mongoClient.db('FaceDectector');
        const collection = db.collection('imageMetadata');
        await collection.insertOne(metadata);

        res.status(201).send({
            message: 'Image and metadata stored successfully',
            metadata: metadata
        });
    } catch (error) {
        console.error('Error storing image and metadata:', error);
        res.status(500).send({ message: 'Error storing image and metadata', error });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
