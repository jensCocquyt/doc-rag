import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * PLAN.md Phase 6 acceptance: upload → process → conversation → select doc →
 * ask → streamed answer → citation → correct page with highlight.
 */

const FACT =
  'The solar array in Ghent produced 4200 megawatt hours during 2025.';

async function buildPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page1 = doc.addPage([595, 842]);
  page1.drawText('Energy Report', { x: 60, y: 770, size: 22, font: bold });
  page1.drawText('This report covers renewable generation for 2025.', {
    x: 60,
    y: 720,
    size: 11,
    font,
  });
  const page2 = doc.addPage([595, 842]);
  page2.drawText('Production', { x: 60, y: 770, size: 22, font: bold });
  page2.drawText(FACT, { x: 60, y: 720, size: 11, font });
  return Buffer.from(await doc.save());
}

test('upload, process, chat and open the cited page with a highlight', async ({
  page,
}) => {
  const fileName = `e2e-energy-${Date.now()}.pdf`;

  // 1-2. Upload a PDF and wait for processing to finish.
  await page.goto('/');
  await page.setInputFiles('input[type="file"]', {
    name: fileName,
    mimeType: 'application/pdf',
    buffer: await buildPdf(),
  });
  const row = page.locator('tr', { hasText: fileName });
  await expect(row).toContainText('ready', { timeout: 90_000 });

  // 3-4. Create a conversation and narrow it to the uploaded document.
  await page.getByRole('link', { name: 'Chat' }).click();
  await page.getByRole('button', { name: 'New conversation' }).click();
  await page.getByText(/Document scope/).click();
  await page.getByRole('checkbox').first().waitFor();
  // click(), not check(): the checkbox is controlled and reflects the
  // selection only after the PATCH round-trip and query refetch.
  await page
    .locator('label', { hasText: fileName })
    .getByRole('checkbox')
    .click();
  await expect(page.getByText(/1 selected/)).toBeVisible();

  // 5-6. Ask a question and watch the streamed answer arrive.
  await page
    .getByPlaceholder('Ask a question about your documents')
    .fill(FACT);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByLabel('messages')).toContainText(fileName, {
    timeout: 60_000,
  });

  // 7-9. Open the citation: correct page and a visible highlight overlay.
  await page
    .getByRole('button', { name: '[1]' })
    .first()
    .click();
  const viewer = page.getByLabel('pdf viewer');
  await expect(viewer).toContainText('page 2');
  await expect(viewer.locator('canvas')).toBeVisible({ timeout: 30_000 });
  await expect(
    viewer.getByTestId('citation-highlight').first(),
  ).toBeVisible();
});
