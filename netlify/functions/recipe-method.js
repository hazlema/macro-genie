import { UserFacingError, streamMethod } from "../../server/chef.js";
import { addUsage, emptyUsage, logUsage } from "../../server/usage.js";
import { fail } from "../../server/http.js";

export const config = {
  path: "/api/recipe-method",
  method: "POST",
  rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

// Streams plain text so the recipe appears as it's written.
export default async function handler(request) {
  try {
    const body = await request.json().catch(() => {
      throw new UserFacingError("Send the request as JSON.");
    });
    const stream = await streamMethod(body);
    const encoder = new TextEncoder();
    const output = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            )
              controller.enqueue(encoder.encode(event.delta.text));
          }
          const final = await stream.finalMessage();
          logUsage("recipe", addUsage(emptyUsage(final.model), final));
          if (final.stop_reason === "refusal")
            controller.enqueue(
              encoder.encode("\n\n[Claude declined to write this recipe.]"),
            );
        } catch (error) {
          console.error(error);
          controller.enqueue(
            encoder.encode("\n\n[The recipe stopped early. Try again.]"),
          );
        } finally {
          controller.close();
        }
      },
      cancel() {
        stream.abort();
      },
    });
    return new Response(output, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
