import { Hono } from "hono";
import { cache } from "hono/cache";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

type Bindings = {
  OPENAI_API_KEY: string;
  CACHE_KV: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(logger());
app.use(cors());

app.get(
  "*",
  cache({
    cacheName: "job-posting-red-flags-detector",
    cacheControl: "public, max-age=3600",
  })
);

const HTMLResp = z.object({
  html: z.string().describe("Output HTML"),
});

const systemMessage = `
You are tasked with identifying things to look out for in a job posting.

You must identify potential red flags and green flags in the job posting. As well as things that may require additional context.

You should wrap the highlighted sections in <span> tags with the following attributes:
- data-highlight boolean value to all
- data-type any of "positive", "negative", "context" or "info"
- data-description a short description of why the text was highlighted
- class "highlight-positive", "highlight-negative", "highlight-context" or "highlight-info"

For example:
<example-input>
<div>
  <p>You will wear many hats</p>
  <p>Our team is like a family</p>
  <p>You have agency to make decisions</p>

  <p>
    <span>Perks:</span>
    <ul>
      <li>Free snacks</li>
      <li>Flexible hours</li>
      <li>Unlimited vacation</li>
      <li>Competitive salary</li>
    </ul>
  </p>
</div>
</example-input>

You should highlight the following:
<example-output>
<div>
  <p><span data-highlight data-type="negative" data-description="Wearing many hats is a common description when the role is not well defined, and you may be expected to do a lot outside the job description." class="highlight-negative">You will wear many hats</span></p>
  <p><span data-highlight data-type="negative" data-description="Treating the team as a family is often used to take advantage of employees' time and ignore work/life boundaries." class="highlight-negative">Our team is like a family</span></p>
  <p><span data-highlight data-type="positive" data-description="Having agency means that you are treated with respect and trusted in the workplace." class="highlight-positive">You have agency to make decisions</span></p>

  <p>
    <span>Perks:</span>
    <ul>
      <li>Free snacks</li>
      <li>Flexible hours</li>
      <li><span data-highlight data-type="context" data-description="Unlimited vacation requires context. You might still be socially restricted from taking vacation in the workplace, and may end up with less vacation time." class="highlight-context">Unlimited vacation</span></li>
      <li><span data-highlight data-type="negative" data-description="Openly sharing pay ranges in job posts fosters transparency and builds trust that your organization pays people fairly. Keeping the salary range hidden is prone to wasting time of both applicants and recruiters time." class="highlight-negative">Competitive salary</span></li>
    </ul>
  </p>
</div>
</example-output>

Be creative with the data-descriptions, but make sure they are clear and concise. Keep the descriptions in the same language as the original input text.

Keep the rest of the HTML exactly as is, and make sure to keep the HTML structure intact. Only wrap parts of the text in <span> tags.

Make sure to always add at least one to three highlights! If you can't find any red flags, or green flags, add context or info highlights.
`;

app.post("/", async (c) => {
  const apiKey = c.env.OPENAI_API_KEY;
  const openai = new OpenAI({
    apiKey,
  });

  const body = await c.req.json();

  if (body.html === undefined) {
    return c.text("no html");
  }

  const input = body.html;
  const inputHashKey = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.html))
    )
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const alreadyGenerated = await c.env.CACHE_KV.get(inputHashKey);
  if (alreadyGenerated !== null) {
    return c.text(alreadyGenerated);
  }

  const completion = await openai.beta.chat.completions.parse({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemMessage },
      {
        role: "user",
        content: input,
      },
    ],
    response_format: zodResponseFormat(HTMLResp, "htmlResp"),
  });

  const newHtml = completion.choices[0].message.parsed?.html;

  if (newHtml) {
    await c.env.CACHE_KV.put(inputHashKey, newHtml);
  }

  return c.text(newHtml ?? "no content in response");
});

export default app;
