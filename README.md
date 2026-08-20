# Personal Website Template

A clean, responsive, and bilingual personal website template for building portfolios, online resumes, and professional profile websites.

Designed to be easy to customize and deploy, the template provides reusable sections for education, experience, projects, skills, awards, and resume links without requiring users to build a portfolio website from scratch.

> **Live Demo:** [example-cv.com](https://example-cv.com)

## ✨ Features

- 🌐 Bilingual interface (English / Chinese)
- 📱 Responsive design for desktop, tablet, and mobile
- 👤 Personal profile and introduction section
- 🎓 Education and experience sections
- 🚀 Project showcase
- 🛠️ Skills and awards sections
- 📄 Chinese and English resume PDF support
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

Then enter the project directory:

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

Most website content can be customized directly in:

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

You can customize spacing, typography, layout, borders, responsive behavior, and other visual details from this file.

## 📄 Resume PDFs

The template supports separate Chinese and English resumes.

Replace:

```text
public/resume_zh.pdf
public/resume_en.pdf
```

with your own PDF files while keeping the same filenames.

The corresponding resume buttons will then open the appropriate PDF.

> The resumes included in this repository are fictional demonstration documents. Replace them with your own information before using the template as a personal website.

## 🔗 Contact & Social Links

Update the example contact information in `app/page.tsx`.

Replace the placeholder values with your own:

```text
Email
LinkedIn
GitHub
```

Make sure to update both the displayed text and the corresponding links.

## ☁️ Deploy to Cloudflare Workers

This project supports deployment to Cloudflare Workers through vinext.

First, log in to Cloudflare:

```bash
npx wrangler login
```

Configure your Worker and required Cloudflare resources in:

```text
wrangler.jsonc
```

Then deploy:

```bash
npx @vinext/cloudflare deploy
```

After deployment, Wrangler will provide a `workers.dev` URL for your website.

You can then configure a custom domain from the Cloudflare dashboard under your Worker's **Domains & Routes** settings.

> Cloudflare resource IDs and account-specific configuration should be replaced with your own values before deployment.

## 🔒 Privacy

The content included in the live demo and public repository is intended for demonstration purposes.

Names, organizations, dates, resumes, projects, and other personal information should be treated as example content.

Before publishing your own version, review the repository carefully and avoid committing:

- API keys or tokens
- `.env` files containing secrets
- Private contact information you do not want to publish
- Personal documents not intended for public access
- Account-specific credentials

## 🤝 Contributing

Contributions, suggestions, and improvements are welcome.

You can:

1. Fork the repository
2. Create a new branch
3. Make your changes
4. Submit a pull request

## 📜 License

This project is intended to be used as an open-source personal website template.

Please refer to the repository's `LICENSE` file for the applicable license terms.

## ⭐ Support

If you find this template useful, consider giving the repository a star.

You are welcome to fork it and customize it for your own portfolio, resume, or personal website.
