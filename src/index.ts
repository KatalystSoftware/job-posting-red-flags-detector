import { Hono } from 'hono'
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

const app = new Hono()

const openai = new OpenAI({
  apiKey: /* todo */,
});

const HTMLResp = z.object({
  html: z.string()
});


const systemMessage = `
You are given a HTML of a job posting. You need to find redflags and greenflags by wrapping them
 in <span class="highlight-negative" data-description="sign of non competent work space"></span> and <span class="highlight-positive" data-description="environmentally conscious"></span>.
Be creative with the data-descriptions.
`

app.post('/', async (c) => {
  const body = await c.req.json()

  if (body.html === undefined) {
    return c.text('no html')
  }

  const input = body.html


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

  const resp = completion.choices[0].message.parsed
  return c.text(resp?.html ?? 'no content in response')
})

export default app
