import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download } from 'lucide-react';

interface QrCodeDisplayProps {
  value: string;
  label?: string;
  size?: number;
}

export function QrCodeDisplay({ value, label, size = 148 }: QrCodeDisplayProps) {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 2,
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  function handleDownload() {
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `qr-${value.toLowerCase()}.png`;
    link.click();
  }

  return (
    <div className="inline-flex flex-col items-center gap-2 p-3 bg-white border border-slate-200 rounded-lg">
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={`Kode QR ${value}`}
          width={size}
          height={size}
          className="rounded border border-slate-100 block"
        />
      ) : (
        <div
          style={{ width: size, height: size }}
          className="bg-slate-100 rounded flex items-center justify-center text-xs text-slate-400"
        >
          Memuat QR...
        </div>
      )}

      <div className="text-center">
        <div className="font-mono text-xs font-medium text-slate-900 tabular-nums">{value}</div>
        {label && <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>}
      </div>

      <div className="flex items-center gap-1.5 w-full justify-center">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap shrink-0"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Disalin' : 'Salin'}</span>
        </button>
        <button
          type="button"
          onClick={handleDownload}
          disabled={!dataUrl}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Unduh</span>
        </button>
      </div>
    </div>
  );
}
