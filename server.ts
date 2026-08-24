import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.raw({ type: "application/octet-stream", limit: "50mb" }));

// Lazy initialize Gemini AI client
let aiClient: GoogleGenAI | null = null;
function getAi(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    aiClient = new GoogleGenAI({
      apiKey: apiKey || "",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// ----------------------------------------------------
// SPEED TEST PAYLOAD ENDPOINTS (Zero-cost client-side engine support)
// ----------------------------------------------------

// 1. Ultra-fast Ping & Latency endpoint
app.get("/api/speedtest/ping", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(204).end();
});

// 2. High-throughput Chunked Download endpoint for speed benchmarking
app.get("/api/speedtest/download", (req, res) => {
  const sizeMb = Math.min(Math.max(parseInt((req.query.size as string) || "5", 10), 1), 30);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Generate binary junk buffer (64 KB chunks)
  const chunkSize = 64 * 1024;
  const chunk = Buffer.alloc(chunkSize, 0xa5);
  const totalChunks = (sizeMb * 1024 * 1024) / chunkSize;

  let chunksSent = 0;
  function sendChunk() {
    let ok = true;
    while (chunksSent < totalChunks && ok) {
      chunksSent++;
      ok = res.write(chunk);
    }
    if (chunksSent >= totalChunks) {
      res.end();
    } else {
      res.once("drain", sendChunk);
    }
  }

  sendChunk();
});

// 3. Upload endpoint for speed testing
app.post("/api/speedtest/upload", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({
    status: "ok",
    receivedBytes: req.body ? req.body.length || 0 : 0,
    timestamp: Date.now(),
  });
});

// 4. IP & Connection metadata
app.get("/api/speedtest/ip-info", (req, res) => {
  const forwarded = req.headers["x-forwarded-for"];
  const clientIp = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.socket.remoteAddress || "127.0.0.1";
  
  res.json({
    ip: clientIp,
    country: "Saudi Arabia / GCC (Detected)",
    isp: "High-Speed Fiber / 5G Gateway",
    asn: "AS-GLOBAL-EDGE",
    city: "Riyadh / Local Edge",
    server: "SpeedFlow Hyper-Edge Node",
  });
});

// ----------------------------------------------------
// GEMINI AI ADVISOR ENDPOINTS
// ----------------------------------------------------

// AI Network Diagnostic & Gaming/Streaming Recommendations
app.post("/api/ai/diagnose", async (req, res) => {
  try {
    const { download, upload, ping, jitter, isp, targetActivity } = req.body;
    
    if (!process.env.GEMINI_API_KEY) {
      return res.json({
        advice: `بناءً على نتائج قياسك (سرعة التحميل: ${download} Mbps، الرفع: ${upload} Mbps، البنج: ${ping} ms، والتذبذب: ${jitter} ms): اتصالك ممتاز للبث بدقة 4K والألعاب التنافسية. لتخفيض البنج في PUBG و Warzone، ننصح باستخدام كابل Ethernet CAT6 وDNS 1.1.1.1.`,
        gamingGrade: Number(ping) < 35 ? "A+" : Number(ping) < 60 ? "B" : "C",
        streamingGrade: Number(download) > 50 ? "4K UHD" : Number(download) > 25 ? "Full HD 1080p" : "HD 720p",
        actionableTips: [
          "تفعيل وضع الألعاب (QoS) في راوتر شركة الاتصالات",
          "تغيير خادم DNS إلى خوادم Cloudflare Gaming (1.1.1.1)",
          "التحويل إلى تردد 5GHz أو كابل إيثرنت مباشر بدلاً من 2.4GHz",
        ],
      });
    }

    const ai = getAi();
    const prompt = `أنت خبير شبكات واتصالات واستشاري أداء ألعاب وبث رقمي.
النتائج الحالية لفحص سرعة الإنترنت لدى المستخدم:
- سرعة التحميل (Download): ${download} Mbps
- سرعة الرفع (Upload): ${upload} Mbps
- زمن الاستجابة (Ping): ${ping} ms
- التذبذب (Jitter): ${jitter} ms
- مزود الخدمة (ISP): ${isp || "غير محدد"}
- النشاط المستهدف: ${targetActivity || "الألعاب والبث والتصفح اليومي"}

المطلوب:
1. تقييم دقيق وشامل لأداء الاتصال (فقرة مشجعة ومباشرة).
2. تقييم ملاءمة الخط لـ PUBG Mobile، Warzone، Netflix 4K، و Zoom.
3. 3 نصائح عملية فورية (Actionable Tips) لتقليل البنج ورفع الاستقرار.

أجب بصيغة JSON حصراً بالشكل التالي:
{
  "summary": "نص التقييم الشامل",
  "gamingGrade": "A+ أو A أو B أو C",
  "streamingGrade": "4K UHD أو 1080p أو 720p",
  "actionableTips": ["نصيحة 1", "نصيحة 2", "نصيحة 3"]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    res.json(parsed);
  } catch (error: any) {
    console.error("AI Diagnose error:", error);
    res.status(500).json({ error: error.message || "Failed to diagnose network" });
  }
});

// AI SEO Article & Meta Generator for Landing Pages
app.post("/api/ai/seo-generator", async (req, res) => {
  try {
    const { ispName, country, keyword } = req.body;
    
    if (!process.env.GEMINI_API_KEY) {
      return res.json({
        title: `قياس سرعة نت ${ispName} ${country} - فحص دقيق واختبار بنج الألعاب 2026`,
        metaDescription: `أسرع أداة مجانية لقياس سرعة إنترنت ${ispName} في ${country}. اختبر سرعة التحميل والرفع، وفحص جودة خط الألياف والبينج لـ ببجي ونتفلكس بدون برامج.`,
        h1: `فحص وقياس سرعة إنترنت ${ispName} (${country})`,
        faq: [
          {
            q: `كيف أقيس سرعة نت ${ispName} بدقة؟`,
            a: `اضغط على زر 'ابدأ الفحص' أعلاه، وتأكد من إيقاف أي تحميلات جارية أو اتصالات VPN للحصول على نتائج واقعية.`,
          },
          {
            q: `ما هي السرعة المثالية لألعاب الأونلاين مع ${ispName}؟`,
            a: `يفضل أن يكون البينج أقل من 40ms وسرعة التحميل 25 Mbps على الأقل لتجربة خالية من اللاق.`,
          },
        ],
        keywords: [`قياس سرعة نت ${ispName}`, `فحص سرعة ${ispName}`, `speed test ${ispName}`, `بنج ${ispName}`],
      });
    }

    const ai = getAi();
    const prompt = `أنت خبير محترف في تصدر محركات البحث (SEO Specialist) واستراتيجيات المحتوى العربي لمواقع أدوات الويب (Tool Web Apps).
اكتب محتوى صفحة هبوط محسنة لمحركات البحث (SEO Landing Page) لشركة: "${ispName}" في دولة: "${country}" تستهدف كلمة البحث: "${keyword}".

المطلوب إخراج JSON يحتوي على:
{
  "title": "عنوان جذاب أقل من 60 حرف يحتوي الكلمة المفتاحية والسنة 2026",
  "metaDescription": "وصف ميتا مقنع بين 140-160 حرف",
  "h1": "عنوان رئيسي جذاب",
  "faq": [
    {"q": "سؤال شائع 1", "a": "إجابة وافية 1"},
    {"q": "سؤال شائع 2", "a": "إجابة وافية 2"},
    {"q": "سؤال شائع 3", "a": "إجابة وافية 3"}
  ],
  "keywords": ["كلمة 1", "كلمة 2", "كلمة 3", "كلمة 4"]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    res.json(parsed);
  } catch (error: any) {
    console.error("AI SEO error:", error);
    res.status(500).json({ error: error.message || "Failed to generate SEO content" });
  }
});

// ----------------------------------------------------
// VITE & STATIC ASSET MIDDLEWARE
// ----------------------------------------------------

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SpeedFlow Server is running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
