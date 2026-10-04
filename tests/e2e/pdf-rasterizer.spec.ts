import { expect, test } from "@playwright/test";

function squarePdf(): number[] {
  const content = "0 0 0 rg\n10 10 80 80 re\nf\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Array.from(new TextEncoder().encode(text));
}

test("PDF rasterization uses the configured worker and preserves pixels after cleanup", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/index.html");
  const result = await page.evaluate(async bytes => {
    const modulePath = "/tests/e2e/fixtures/pdf-rasterizer-entry.ts";
    const { rasterizePdfPage1 } = await import(/* @vite-ignore */ modulePath);
    const canvas = await rasterizePdfPage1(new Uint8Array(bytes), { maxWidth: 100 });
    if (!canvas) return null;
    return {
      size: [canvas.width, canvas.height],
      center: Array.from(canvas.getContext("2d").getImageData(50, 50, 1, 1).data),
      corner: Array.from(canvas.getContext("2d").getImageData(1, 1, 1, 1).data),
    };
  }, squarePdf());
  expect(result).toEqual({ size: [100, 100], center: [0, 0, 0, 255], corner: [255, 255, 255, 255] });
});
