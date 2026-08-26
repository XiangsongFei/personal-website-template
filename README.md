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
- Contact information

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
- Desktop layout
- Tablet layout
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
- Resume links
- Other profile links if needed

Make sure to update both the displayed text and the corresponding URLs.

## 🌐 Bilingual Content

The website provides both Chinese and English versions of the main content.

When adding or modifying sections, make sure that the corresponding content is updated for both languages so that the language switch remains consistent.

The bilingual content and frontend language-switching logic are primarily located in:

```text
app/page.tsx
```

## 🌍 Automatic Locale Detection

The website supports automatic initial language selection based on the visitor's region.

When no manual language preference has been stored for the current browser session, the frontend requests:

```text
/api/locale
```

The locale endpoint is handled by the Cloudflare Worker in:

```text
worker/index.ts
```

The Worker uses Cloudflare request metadata to determine the visitor's country or region.

The default behavior is:

- Visitors detected from China (`CN`) are shown the Chinese version.
- Visitors from other regions are shown the English version.
- If region information is unavailable, the browser language can be used as a fallback.

This allows the public website to provide a more appropriate initial language without requiring the visitor to select one manually.

## 🔄 Language Preference

Visitors can manually switch between Chinese and English at any time.

After a visitor manually selects a language, the preference is stored using browser:

```text
sessionStorage
```

The preference is preserved during the current browser session.

This means that refreshing or navigating within the website will not immediately override the visitor's manually selected language with automatic region detection.

Because the preference is session-based rather than permanently stored, a new browser session can perform automatic locale detection again.

## 🧭 Navigation and Responsive Behavior

The template provides section-based navigation for the main portfolio content.

Sections can include:

- About
- Experience
- Projects
- Skills
- Awards
- Contact

The layout and navigation behavior are designed to adapt across:

- Desktop
- Tablet
- Mobile

Responsive styling is primarily defined in:

```text
app/globals.css
```

Navigation, section interaction, language behavior, and related frontend logic are primarily handled in:

```text
app/page.tsx
```

If you significantly change section heights, spacing, navigation layout, or responsive breakpoints, review the related navigation and scroll behavior as well.

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

If your configuration uses Cloudflare KV, create your own KV namespace and use its namespace ID in your Cloudflare configuration.

Cloudflare KV is optional for the basic website functionality unless your deployment configuration specifically requires it.

The Worker also provides the locale endpoint used for automatic language detection:

```text
/api/locale
```

### 3. Build the project

Before deployment, verify that the project builds successfully:

```bash
npm run build
```

A successful build confirms that the current source code can be compiled for deployment.

Depending on the vinext configuration, you may see a warning related to the optional `VINEXT_KV_CACHE` binding when no KV namespace is configured.

For example:

```text
The KV data cache adapter requires a VINEXT_KV_CACHE KV namespace binding.
```

If the build still completes successfully and the application falls back to the default cache handler, the warning does not necessarily prevent deployment.

### 4. Deploy

Run:

```bash
npx @vinext/cloudflare deploy
```

The project will be built and deployed to Cloudflare Workers.

After deployment, Wrangler will provide a `workers.dev` URL that can be used to verify the deployment.

### 5. Add a Custom Domain

After confirming that the `workers.dev` deployment works correctly, you can connect your own domain from the Cloudflare dashboard.

Go to your Worker and open:

```text
Settings → Domains & Routes
```

Then add your custom domain.

## 🔄 Updating Your Deployment

After modifying the website, first verify that the project still builds successfully:

```bash
npm run build
```

Then deploy the latest version again:

```bash
npx @vinext/cloudflare deploy
```

Cloudflare will update the existing Worker deployment with the latest build.

If you update files directly through the GitHub website, commit the changes to the appropriate branch.

> **Note:** Updating the GitHub repository does not automatically update the live Cloudflare Worker unless you have separately configured an automatic deployment workflow.

Without automatic deployment, pull or synchronize the latest repository changes locally and deploy the project again.

## 🔒 Privacy

The content included in the live demo and public repository is intended for demonstration purposes.

Names, organizations, dates, resumes, projects, links, contact information, and other personal details included in the demo should be treated as fictional or placeholder content.

Before publishing your own version, carefully review the repository and avoid committing:

- API keys or tokens
- Passwords or credentials
- `.env` files containing secrets
- Private contact information you do not want to publish
- Personal documents not intended for public access
- Cloudflare authentication credentials
- Private API credentials
- Account-specific secrets
- Other sensitive or personally identifiable information

Public portfolio websites and public GitHub repositories are accessible to others and may also be indexed by search engines, so review all content before deployment.

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
