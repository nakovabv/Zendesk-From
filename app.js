const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const formidable = require("formidable");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

// Function to upload attachment and get token
const uploadAttachmentAndGetToken = async (attachment) => {
  try {
    const config = {
      method: "post",
      maxBodyLength: Infinity,
      url: `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/uploads.json?filename=${attachment.originalFilename}`,
      headers: {
        "Content-Type": attachment.mimetype,
        Authorization: `Basic ${Buffer.from(
          `${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_PASSWORD}`
        ).toString("base64")}`,
      },
      data: fs.readFileSync(attachment.filepath),
    };
    const response = await axios.request(config);
    return response.data.upload.token;
  } catch (error) {
    console.error("Error uploading attachment:", error);
    throw error;
  }
};

// Use CSS Style
app.use("/", express.static(__dirname + "/"));

// Use body-parser middleware to parse URL-encoded data
app.use(bodyParser.urlencoded({ extended: true }));

// Render the form with reCAPTCHA
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

// Handle form submission
app.post("/submit", async (req, res) => {
  try {
    const form = new formidable.IncomingForm();
    form.options.allowEmptyFiles = true; // Allow files with size 0
    form.options.minFileSize = 0; // Allow files with size 0
    form.parse(req, async (err, fields, files) => {
      if (err) {
        // Handle form parsing error
        console.error("Error parsing form:", err);
        res.status(500).send("Error");
        return;
      }

      const captchaResponse = fields["g-recaptcha-response"];
      const secretKey = process.env.RECAPTCHA_SECRET_KEY;

      // Verify reCAPTCHA response token
      const response = await axios.post(
        `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${captchaResponse}`
      );
      const { success } = response.data;
      console.log(response.data);
      if (!success) {
        // reCAPTCHA validation failed
        return res.status(400).send("reCAPTCHA validation failed");
      }

      let formData = {
        request: {
          subject: fields.subject[0],
          comment: {
            body: `New support ticket from ${fields.name[0]}
                    Contact phone number: ${fields.phone[0]}
                    Order number: ${fields.order[0]}
                    Product SKU: ${fields.sku[0]}
                    Description:  ${fields.description[0]}`,
          },
          requester: {
            name: fields.name[0],
            email: fields.email[0],
          },
        },
      };

      if (files.attachment.length) {
        // Check if multiple files are uploaded
        const attachmentTokens = await Promise.all(
          files.attachment.map(async (file) => {
            if (file.size !== 0) {
              return uploadAttachmentAndGetToken(file); // Upload each file and get token
            }
          })
        );

        formData.request.comment.uploads = attachmentTokens.filter(Boolean); // Filter out undefined values
      } else if (files.attachment.size !== 0) {
        // Single file scenario
        const attachmentToken = await uploadAttachmentAndGetToken(
          files.attachment
        );
        formData.request.comment.uploads = [attachmentToken];
      }

      const options = {
        method: "post",
        url: `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/requests.json`,
        headers: {
          "Content-Type": "application/json",
        },
        auth: {
          username: process.env.ZENDESK_EMAIL,
          password: process.env.ZENDESK_PASSWORD,
        },
        data: JSON.stringify(formData), // Convert form data to JSON string
      };

      await axios(options); // Send request to Zendesk API
      res.status(200).send("Form submitted successfully");
    });
  } catch (error) {
    console.error("Error submitting form:", error);
    res.status(500).send("Error");
  }
});

// Start the server
app.listen(process.env.PORT, () => {
  console.log(
    `Server running on port ${process.env.PORT}. Visit http://localhost:${process.env.PORT}`
  );
});
