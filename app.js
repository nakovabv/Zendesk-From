const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const Recaptcha = require("express-recaptcha").RecaptchaV2;
const formidable = require("formidable");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

// Create a reCAPTCHA instance
const recaptcha = new Recaptcha(
  process.env.RECAPTCHA_SITE_KEY,
  process.env.RECAPTCHA_SECRET_KEY
);

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
app.use("/",express.static(__dirname + "/"));

// Use body-parser middleware to parse URL-encoded data
app.use(bodyParser.urlencoded({ extended: true }));


// Render the form with reCAPTCHA
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.get("/", recaptcha.middleware.render, (req, res) => {
  const form = `
    <form id="supportForm" action="/submit" method="post" enctype="multipart/form-data" style="width: 100%; max-width: max-content;">
        <div>
            <input class="form-control contact-form" type="text" name="subject" placeholder="Subject*" required>
            <input class="form-control contact-form" type="text" name="name" placeholder="Your Name*" required>
            <input class="form-control contact-form" type="email" name="email" placeholder="Your Email*" required>
            <input class="form-control contact-form" type="text" name="phone" placeholder="Contact Phone Number*"
                required>
            <input class="form-control contact-form" type="text" name="order" placeholder="Order Number*" required>
            <input class="form-control contact-form" type="text" name="sku" placeholder="Product SKU*" required>
            <textarea class="form-control contact-form" name="description" rows="6" placeholder="Your Message*"
                required></textarea>
            <label style="font-weight: 600;" for="attachment">File Upload</label>
            <input type="file" name="attachment" accept="image/*" multiple>
        </div>
        <div class="g-recaptcha" data-sitekey="6Lcie30pAAAAAH7nq9IRGrA5-JTNm0gD7YXxYxdI"></div>
        <!-- Replace with your reCAPTCHA site key -->
        <div>
            <button class="btn btn-lg btn-default btn-contact-form" type="submit">Send Support Ticket</button>
        </div>
    </form>
    `;
  res.send(form);
});


// Handle form submission
app.post("/submit", recaptcha.middleware.verify, async (req, res) => {
  if (!req.recaptcha.error) {
    // If reCAPTCHA verification is successful
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
  } else {
    // If reCAPTCHA verification fails
    res.status(400).send("reCAPTCHA verification failed");
  }
});

// Start the server
app.listen(process.env.PORT, () => {
  console.log(
    `Server running on port ${process.env.PORT}. Visit http://localhost:${process.env.PORT}`
  );
});
