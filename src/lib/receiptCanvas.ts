import {
  RECEIPT_WATERMARK,
  SIMULATOR_BANNER,
  formatAccountNumber,
  formatDateTimeVN,
  formatPlaycoin,
  type TransactionRecord,
} from './banking';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

/**
 * Render a crisp 2x PNG transaction receipt with mandatory PLAYBANK SIMULATOR watermark
 * and trigger an immediate image download.
 */
export function downloadReceiptImage(tx: TransactionRecord): void {
  const width = 760;
  const height = 1040;
  const scale = 2;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.scale(scale, scale);

  // Outer canvas background
  ctx.fillStyle = '#EEF2F8';
  ctx.fillRect(0, 0, width, height);

  // Main receipt card
  const cardX = 40;
  const cardY = 36;
  const cardW = width - 80;
  const cardH = height - 72;

  ctx.save();
  ctx.shadowColor = 'rgba(11, 23, 42, 0.12)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 24);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();

  // Clip inside card for header & diagonal watermark
  ctx.save();
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 24);
  ctx.clip();

  // Top navy-sapphire gradient header
  const headerGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + 230);
  headerGrad.addColorStop(0, '#0B172A');
  headerGrad.addColorStop(1, '#1D4ED8');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(cardX, cardY, cardW, 248);

  // Brand title
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 26px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('PLAYBANK', cardX + 36, cardY + 54);

  ctx.fillStyle = 'rgba(219, 234, 254, 0.9)';
  ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(SIMULATOR_BANNER, cardX + 36, cardY + 76);

  // Success circle checkmark
  const cx = width / 2;
  const cy = cardY + 132;
  ctx.beginPath();
  ctx.arc(cx, cy, 26, 0, Math.PI * 2);
  ctx.fillStyle = '#10B981';
  ctx.fill();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy + 1);
  ctx.lineTo(cx - 2, cy + 9);
  ctx.lineTo(cx + 11, cy - 7);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Chuyển tiền ảo thành công', cx, cardY + 184);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 34px "JetBrains Mono", monospace';
  ctx.fillText(`${formatPlaycoin(tx.amount)} PLAYCOIN`, cx, cardY + 226);

  // Diagonal subtle receipt watermark over body
  ctx.save();
  ctx.translate(width / 2, cardY + 560);
  ctx.rotate((-24 * Math.PI) / 180);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.055)';
  ctx.font = '800 20px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  for (let row = -2; row <= 2; row++) {
    ctx.fillText(RECEIPT_WATERMARK, 0, row * 115);
  }
  ctx.restore();

  // Transaction details rows
  const rows: Array<{ label: string; value: string; mono?: boolean; accent?: string }> = [
    { label: 'Mã giao dịch', value: tx.txCode, mono: true },
    { label: 'Thời gian', value: formatDateTimeVN(tx.createdAt), mono: true },
    { label: 'Trạng thái', value: 'Hoàn tất (Đã ghi nhận)', accent: '#059669' },
    { label: 'Phương thức', value: tx.method === 'qr' ? 'Quét mã QR nội bộ PLAYBANK' : 'Chuyển qua số tài khoản' },
    { label: 'Người gửi', value: `${tx.senderName} (${formatAccountNumber(tx.senderAccount)})` },
    { label: 'Người nhận', value: `${tx.recipientName} (${formatAccountNumber(tx.recipientAccount)})` },
    { label: 'Nội dung chuyển', value: tx.note },
  ];

  let y = cardY + 292;
  const leftX = cardX + 36;
  const rightX = cardX + cardW - 36;

  rows.forEach((row, index) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#64748B';
    ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(row.label, leftX, y);

    ctx.textAlign = 'right';
    ctx.fillStyle = row.accent || '#0F172A';
    ctx.font = row.mono
      ? '600 14px "JetBrains Mono", monospace'
      : '600 15px "Plus Jakarta Sans", sans-serif';

    const lines = wrapText(ctx, row.value, 390);
    lines.forEach((line, lineIdx) => {
      ctx.fillText(line, rightX, y + lineIdx * 22);
    });

    const rowHeight = Math.max(46, lines.length * 22 + 24);
    if (index < rows.length - 1) {
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftX, y + rowHeight - 18);
      ctx.lineTo(rightX, y + rowHeight - 18);
      ctx.stroke();
    }
    y += rowHeight;
  });

  // Prominent footer watermark box
  const footerY = cardY + cardH - 110;
  drawRoundedRect(ctx, leftX, footerY, cardW - 72, 74, 14);
  ctx.fillStyle = '#F1F5F9';
  ctx.fill();
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#1E3A8A';
  ctx.font = '800 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(RECEIPT_WATERMARK, width / 2, footerY + 31);

  ctx.fillStyle = '#475569';
  ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    'Biên nhận này chỉ phục vụ trò chơi mô phỏng PLAYBANK và không có giá trị quy đổi tiền thật.',
    width / 2,
    footerY + 54
  );

  ctx.restore();

  const dataUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `PLAYBANK-BienNhan-${tx.txCode}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
