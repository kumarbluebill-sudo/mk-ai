"use client";

import { useState } from "react";

interface Created {
  id: string;
  reference: string;
  validUntil: string;
  currency: string;
  taxable: number;
  taxLines: { label: string; ratePercent: number; amount: number }[];
  discount: number;
  total: number;
  /** Only returned to roles that may see cost. */
  subtotal?: number;
  markup?: number;
}
interface Warnings {
  unpricedItems: string[];
  itemsNotVerifiedLive: string[];
  note: string;
}

type TaxMode = "NONE" | "SINGLE" | "INTRA_STATE" | "INTER_STATE";

const money = (n: number, c: string) => `${c} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function QuotePanel({ conversationId }: { conversationId: string }) {
  const [mode, setMode] = useState<TaxMode>("NONE");
  const [rate, setRate] = useState("");
  const [discount, setDiscount] = useState("");
  const [validDays, setValidDays] = useState("3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ q: Created; warnings: Warnings } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ratePercent = Number(rate);
    if (mode !== "NONE" && (!Number.isFinite(ratePercent) || rate.trim() === "")) {
      setError("Enter the tax rate your accountant has set for this service.");
      setBusy(false);
      return;
    }
    const body = {
      discount: discount.trim() ? Number(discount) : 0,
      validDays: Number(validDays) || 3,
      ...(mode === "SINGLE" && { taxPercent: ratePercent }),
      ...((mode === "INTRA_STATE" || mode === "INTER_STATE") && { gst: { ratePercent, supply: mode } }),
    };
    try {
      const res = await fetch(`/api/itineraries/${conversationId}/quotation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { quotation?: Created; warnings?: Warnings; error?: string; message?: string };
      if (!res.ok || !data.quotation || !data.warnings) {
        throw new Error(data.message ?? (data.error === "Invalid quotation options" ? "Check the numbers you entered." : (data.error ?? "Could not create the quotation")));
      }
      setResult({ q: data.quotation, warnings: data.warnings });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the quotation");
    } finally {
      setBusy(false);
    }
  }

  const input = "rounded border px-2 py-1 text-sm";
  return (
    <section aria-label="Quotation" className="space-y-3 rounded border p-3">
      <h2 className="font-medium">Quotation</h2>
      <p className="text-xs text-gray-500">
        Priced from the items that have a price. This creates a draft quotation and a PDF. It does not book or reserve anything.
        Tax rates are yours to set; none are assumed.
      </p>
      <form onSubmit={create} className="grid gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">
          Tax
          <select className={input} value={mode} onChange={(e) => setMode(e.target.value as TaxMode)}>
            <option value="NONE">No tax</option>
            <option value="INTRA_STATE">GST within the same state (CGST + SGST)</option>
            <option value="INTER_STATE">GST across states (IGST)</option>
            <option value="SINGLE">Single tax rate</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Rate %
          <input className={input} inputMode="decimal" disabled={mode === "NONE"} value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Discount
          <input className={input} inputMode="decimal" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Valid for (days)
          <input className={input} inputMode="numeric" value={validDays} onChange={(e) => setValidDays(e.target.value)} />
        </label>
        <div className="sm:col-span-3" />
        <button disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-60">
          {busy ? "Creating…" : "Create quotation"}
        </button>
      </form>

      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {result && (
        <div className="space-y-2 rounded bg-gray-50 p-3 text-sm">
          <p className="font-medium">{result.q.reference} <span className="text-xs font-normal text-gray-500">DRAFT · valid until {result.q.validUntil}</span></p>
          <table className="w-full max-w-sm text-sm">
            <tbody>
              {result.q.subtotal !== undefined && result.q.markup !== undefined && (
                <tr className="text-xs text-gray-500"><td>Internal: cost {money(result.q.subtotal, result.q.currency)}, markup {money(result.q.markup, result.q.currency)}</td><td /></tr>
              )}
              {result.q.discount > 0 && <tr><td>Discount</td><td className="text-right">- {money(result.q.discount, result.q.currency)}</td></tr>}
              <tr><td>Amount before tax</td><td className="text-right">{money(result.q.taxable, result.q.currency)}</td></tr>
              {result.q.taxLines.map((t) => (
                <tr key={t.label}><td>{t.label} @ {+t.ratePercent.toFixed(4)}%</td><td className="text-right">{money(t.amount, result.q.currency)}</td></tr>
              ))}
              <tr className="border-t font-semibold"><td>Total</td><td className="text-right">{money(result.q.total, result.q.currency)}</td></tr>
            </tbody>
          </table>
          {result.warnings.unpricedItems.length > 0 && (
            <p className="text-xs text-amber-800">Not priced (not in the total): {result.warnings.unpricedItems.join(", ")}</p>
          )}
          {result.warnings.itemsNotVerifiedLive.length > 0 && (
            <p className="text-xs text-amber-800">Priced but not checked with a supplier (indicative): {result.warnings.itemsNotVerifiedLive.join(", ")}</p>
          )}
          <a href={`/api/quotations/${result.q.id}/pdf`} className="inline-block rounded border bg-white px-3 py-1 text-blue-700 underline">
            Download PDF
          </a>
        </div>
      )}
    </section>
  );
}
