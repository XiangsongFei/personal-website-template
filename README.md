# Personal Website Template

A clean, responsive, and bilingual personal website template for building portfolios, online resumes, and professional profile websites.

Designed to be easy to customize and deploy, this template provides reusable sections for education, experience, projects, skills, awards, contact information, and resume links without requiring you to build a portfolio website from scratch.

> **Live Demo:** [example-cv.com](https://example-cv.com)

## ✨ Features

- 🌐 Bilingual interface (English / Chinese)
- 🌍 Automatic initial language detection based on visitor region
- 🔄 Manual language preference preserved during the current browser session
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
- **Optional Cache:** Cloudflare KV
- **Package Manager:** npm

## 📂 Project Structure

```text
personal-website-template/
├── app/
│   ├── globals.css        # Global styles and responsive layout
│   ├── layout.tsx         # Root layout and metadata
│   └── page.tsx           # Main website content, bilingual logic, and interactions
│
├── public/
│   ├── resume_en.pdf      # English resume
│   └── resume_zh.pdf      # Chinese resume
│
├── worker/
│   └── index.ts           # Cloudflare Worker entry and locale API
│
├── wrangler.jsonc         # Cloudflare Workers configuration
├── package.json
└── README.md
