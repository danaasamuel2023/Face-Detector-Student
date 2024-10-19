const express = require('express');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { RekognitionClient, CompareFacesCommand } = require('@aws-sdk/client-rekognition');
const multer = require('multer');

// Configure AWS SDK v3 clients with credentials from environment variables
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
const bucketName = 'unimarketgh';

// Middleware to parse JSON request bodies
app.use(express.json());

// Multer middleware to handle image uploads temporarily (in memory)
const upload = multer({
    storage: multer.memoryStorage(), // Store images in memory
});

// Endpoint to upload and compare images
app.post('/upload', upload.single('image'), async (req, res) => {
    try {
        const uploadedImage = req.file;

        if (!uploadedImage) {
            return res.status(400).send({ message: 'Image upload failed' });
        }

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

        // Compare the uploaded image with each image in the uploads folder
        for (const item of s3Objects.Contents) {
            // Skip comparison if the item is the uploaded image
            if (item.Key.includes(uploadedImage.originalname)) {
                console.log('Skipping comparison with itself:', uploadedImage.originalname);
                continue;
            }

            // Compare with existing images in S3
            const compareParams = {
                SourceImage: {
                    Bytes: uploadedImage.buffer // Use the in-memory buffer for the uploaded image
                },
                TargetImage: {
                    S3Object: {
                        Bucket: bucketName,
                        Name: item.Key
                    }
                },
                SimilarityThreshold: 80
            };

            console.log('Comparing:', uploadedImage.originalname, 'with', item.Key); // Debugging output

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
            res.status(200).send({
                message: 'Best matching image found',
                match: bestMatch
            });
        } else {
            res.status(404).send({ message: 'No matching images found' });
        }
    } catch (error) {
        console.error('Error comparing images:', error);
        res.status(500).send({ message: 'Error comparing images', error });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
