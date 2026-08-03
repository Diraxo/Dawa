// Generates the 7 Play Store marketing screenshots (1240x2208) by compositing
// real app screenshots from store/screenshots/raw/ into a device frame with
// headline/subtitle overlays. Run: node store/screenshots/generate.js
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', 'carehub-web', 'node_modules', 'playwright-core'));

const ROOT = __dirname;
const RAW_DIR = path.join(ROOT, 'raw');
const OUT_DIR = path.join(ROOT, 'output');
const FONTS_DIR = path.join(ROOT, '..', '..', 'node_modules', '@expo-google-fonts', 'montserrat');

const SCREENS = [
  {
    out: '01-home.png',
    raw: 'Home.jpg',
    headline: 'Trusted Healthcare Anywhere',
    subtitle: 'Connect with verified doctors anytime through secure consultations.',
  },
  {
    out: '02-find-doctor.png',
    raw: 'Find doctors.jpg',
    headline: 'Find Trusted Specialists',
    subtitle: 'Browse verified doctors by specialty and consultation fee.',
  },
  {
    out: '03-doctor-profile.png',
    raw: 'doctor profile.jpg',
    headline: 'Verified Doctor Profiles',
    subtitle: 'View qualifications, experience, languages and availability before booking.',
  },
  {
    out: '04-booking.png',
    raw: 'choose chat, voice, video.jpg',
    headline: 'Book in Minutes',
    subtitle: 'Choose chat, voice or video consultations with flexible scheduling.',
  },
  {
    out: '05-consultation.png',
    raw: 'waiting room.jpg',
    headline: 'Secure Consultations',
    subtitle: 'Private chat, voice and video consultations from anywhere.',
  },
  {
    out: '06-consultation-summary.png',
    raw: 'consultation sumaru.jpg',
    headline: 'Consultation Summary',
    subtitle: 'Access diagnoses, prescriptions and follow-up recommendations instantly.',
  },
];

function b64(file) {
  return fs.readFileSync(file).toString('base64');
}

function placeholderDataUrl(label) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="760" height="1647">
      <rect width="100%" height="100%" fill="#E4E9F0"/>
      <text x="50%" y="50%" font-family="sans-serif" font-size="36" fill="#7A8699"
        text-anchor="middle" dominant-baseline="middle">${label}</text>
    </svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

async function main() {
  const template = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8');

  const font400 = b64(path.join(FONTS_DIR, '400Regular', 'Montserrat_400Regular.ttf'));
  const font500 = b64(path.join(FONTS_DIR, '500Medium', 'Montserrat_500Medium.ttf'));
  const font600 = b64(path.join(FONTS_DIR, '600SemiBold', 'Montserrat_600SemiBold.ttf'));
  const font700 = b64(path.join(FONTS_DIR, '700Bold', 'Montserrat_700Bold.ttf'));

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1240, height: 2208 } });

  for (const screen of SCREENS) {
    const rawPath = path.join(RAW_DIR, screen.raw);
    let screenshotUrl;
    if (fs.existsSync(rawPath)) {
      const ext = path.extname(rawPath).slice(1);
      screenshotUrl = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b64(rawPath)}`;
    } else {
      console.warn(`[warn] missing raw/${screen.raw} — using placeholder`);
      screenshotUrl = placeholderDataUrl(screen.raw);
    }

    const html = template
      .replaceAll('__FONT_400__', font400)
      .replaceAll('__FONT_500__', font500)
      .replaceAll('__FONT_600__', font600)
      .replaceAll('__FONT_700__', font700)
      .replaceAll('__HEADLINE__', screen.headline)
      .replaceAll('__SUBTITLE__', screen.subtitle)
      .replaceAll('__SCREENSHOT_URL__', screenshotUrl);

    await page.setContent(html, { waitUntil: 'networkidle' });
    const outPath = path.join(OUT_DIR, screen.out);
    await page.screenshot({ path: outPath });
    console.log(`[ok] ${screen.out}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
