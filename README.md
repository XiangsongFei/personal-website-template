# Personal Website Template

A clean, responsive, and bilingual personal website template for building portfolios, online resumes, and professional profile websites.

Designed to be easy to customize and deploy, this template provides reusable sections for education, experience, projects, skills, awards, contact information, and resume links without requiring you to build a portfolio website from scratch.

> **Live Demo:** [example-cv.com](https://example-cv.com)

## ✨ Features

- 🌐 Bilingual interface (English / Chinese)
- 📱 Responsive design for desktop, tablet, and mobile
- 👤 Personal profile and introduction section
- 🎓 Education and experience sections
- 🚀 Project showcase
- 🛠️ Skills and awards sections
- 📄 Separate Chinese and English resume PDF support
- 🔗 Email, LinkedIn, and GitHub links
- ☁️ Cloudflare Workers deployment support
- ⚡ Lightweight and fast frontend experience
- 🎨 Easy-to-customize content and styling

## 🛠️ Tech Stack

- **Framework:** Next.js / vinext
- **Frontend:** React + TypeScript
- **Styling:** CSS
- **Deployment:** Cloudflare Workers
- **Cache:** Cloudflare KV
- **Package Manager:** npm

## 📂 Project Structure

```text
personal-website-template/
├── app/
│   ├── globals.css        # Global styles and responsive layout
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Main website content and bilingual data
│
├── public/
│   ├── resume_en.pdf      # English resume
│   └── resume_zh.pdf      # Chinese resume
│
├── worker/                # Cloudflare Worker entry
├── wrangler.jsonc         # Cloudflare Workers configuration
├── package.json
└── README.md
```

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/XiangsongFei/personal-website-template.git
```

Enter the project directory:

```bash
cd personal-website-template
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev
```

Open the local URL shown in your terminal to preview the website.

## ✏️ Customization

Most of the website content can be customized directly in:

```text
app/page.tsx
```

You can replace the example content with your own:

- Name and introduction
- Education
- Experience
- Projects
- Skills
- Awards
- Email
- LinkedIn
- GitHub
- Resume links

The template contains both Chinese and English content. When customizing the website, remember to update both language versions where applicable.

### Styling

Global styles and responsive behavior are located in:

```text
app/globals.css
```

You can customize:

- Typography
- Spacing
- Section layout
- Borders and dividers
- Navigation
- Responsive behavior
- Mobile layout
- Other visual details

## 📄 Resume PDFs

The template supports separate Chinese and English resume files.

Replace:

```text
public/resume_zh.pdf
public/resume_en.pdf
```

with your own PDF files while keeping the same filenames.

The corresponding resume buttons on the website will automatically open the appropriate PDF.

> **Note:** The resumes included in this repository are fictional demonstration documents. Replace them with your own resume files before using the template as a personal website.

## 🔗 Contact & Social Links

Update the example contact information in:

```text
app/page.tsx
```

Replace the placeholder values with your own:

- Email
- LinkedIn
- GitHub

Make sure to update both the displayed text and the corresponding URLs.

## 🌐 Bilingual Content

The website provides both Chinese and English versions of the main content.

When adding or modifying sections, make sure that the corresponding content is updated for both languages so that the language switch remains consistent.

You can customize the bilingual content directly in:

```text
app/page.tsx
```

## ☁️ Deploy to Cloudflare Workers

This project supports deployment to Cloudflare Workers through vinext.

### 1. Log in to Cloudflare

```bash
npx wrangler login
```

### 2. Configure Cloudflare

Configure your Worker and required Cloudflare resources in:

```text
wrangler.jsonc
```

Cloudflare resource IDs and account-specific settings should be replaced with your own values before deployment.

If your configuration uses Cloudflare KV, create your own KV namespace and use its namespace ID in your local Cloudflare configuration.

### 3. Deploy

Run:

```bash
npx @vinext/cloudflare deploy
```

The project will be built and deployed to Cloudflare Workers.

After deployment, Wrangler will provide a `workers.dev` URL for your website.

### 4. Add a Custom Domain

After confirming that the `workers.dev` deployment works correctly, you can connect your own domain from the Cloudflare dashboard.

Go to your Worker and open:

```text
Settings → Domains & Routes
```

Then add your custom domain.

## 🔄 Updating Your Deployment

After modifying the website, deploy the latest version again with:

```bash
npx @vinext/cloudflare deploy
```

Cloudflare will update the existing Worker deployment with the latest build.

## 🔒 Privacy

The content included in the live demo and public repository is intended for demonstration purposes.

Names, organizations, dates, resumes, projects, and other personal information included in the demo should be treated as fictional or placeholder content.

Before publishing your own version, carefully review the repository and avoid committing:

- API keys or tokens
- Passwords or credentials
- `.env` files containing secrets
- Private contact information you do not want to publish
- Personal documents not intended for public access
- Cloudflare authentication credentials
- Other account-specific secrets

Public portfolio websites are searchable and accessible to others, so review all content before deployment.

## 🤝 Contributing

Contributions, suggestions, and improvements are welcome.

To contribute:

1. Fork the repository
2. Create a new branch
3. Make your changes
4. Commit your changes
5. Push the branch to your fork
6. Submit a pull request

## 📜 License

This project is licensed under the MIT License.

See the [LICENSE](LICENSE) file for details.

## ⭐ Support

If you find this template useful, consider giving the repository a star.

You are welcome to fork the project and customize it for your own portfolio, resume, or personal website.
