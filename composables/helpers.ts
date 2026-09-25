import type { Invoice, InvoiceProductLine } from "~/types";

export function formatePrice(price: unknown): string {
  if (price === null || price === undefined || price === "") return "0";
  const num = Number(price);
  if (Number.isNaN(num)) return "0";
  if (!import.meta.client) return String(num);
  try {
    const formatter = new Intl.NumberFormat("ar-US", {
      currencyDisplay: "symbol",
      currencySign: "standard",
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      localeMatcher: "best fit",
      style: "decimal",
    });
    return formatter.format(num).replace(".00", "");
  } catch {
    return String(num);
  }
}

export function formatDate(date: unknown, options?: { time?: boolean }): string {
  if (!date) return "-";
  try {
    const d = date instanceof Date ? date : (date as { seconds?: number })?.seconds
      ? new Date((date as { seconds: number }).seconds * 1000)
      : new Date(date as string);
    if (isNaN(d.getTime())) return "-";
    const fmt = new Intl.DateTimeFormat("ar", {
      month: "numeric",
      year: "numeric",
      day: "2-digit",
    });
    return fmt.format(d);
  } catch {
    return typeof date === "string" ? date : "";
  }
}

export function formatTime12Hour(date: unknown): string {
  if (!date) return "-";
  let hours: number | undefined;
  let minutes: number | undefined;
  if (date instanceof Date) {
    if (isNaN(date.getTime())) return "-";
    hours = date.getHours();
    minutes = date.getMinutes();
  } else if (typeof date === "string") {
    if (date.includes("م") || date.includes("ص")) return date;
    if (date.includes("GMT")) {
      const d = new Date(date);
      if (isNaN(d.getTime())) return "-";
      hours = d.getHours();
      minutes = d.getMinutes();
    } else {
      const parts = date.split(":");
      hours = Number((parts[0] || "00").replace(/[^\d]/g, ""));
      minutes = Number((parts[1] || "00").replace(/[^\d]/g, ""));
      if (Number.isNaN(hours) || Number.isNaN(minutes)) return "-";
    }
  } else {
    return "-";
  }
  const ampm = Number(hours) >= 12 ? "م" : "ص";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const mm = Number(minutes) < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours}:${mm} ${ampm}`;
}

export function calcTotal(invoiceData: Pick<Invoice, "products" | "debt" | "amount_of_animal_feeds" | "amount_of_mahros" | "delivery_price"> | null | undefined): number {
  if (!invoiceData || !Array.isArray(invoiceData.products)) return 0;
  const productsTotal = invoiceData.products
    .map((el) => Number(el.product_price || 0) * Number(el.product_quantity || 0))
    .reduce((prev, current) => prev + (Number.isFinite(current) ? current : 0), 0);
  return (
    productsTotal +
    Number(invoiceData.debt || 0) +
    Number(invoiceData.amount_of_animal_feeds || 0) +
    Number(invoiceData.amount_of_mahros || 0) +
    Number(invoiceData.delivery_price || 0)
  );
}

export function calcLineTotal(form: Pick<InvoiceProductLine, "product_price" | "product_quantity">): number {
  const price = Number(form.product_price || 0);
  const qty = Number(form.product_quantity || 0);
  if (!Number.isFinite(price) || !Number.isFinite(qty)) return 0;
  return price * qty;
}

export function discountAmountFor(invoice: Pick<Invoice, "discount" | "discount_percentage"> & { products?: InvoiceProductLine[] } & Record<string, unknown>): number {
  if (invoice.discount && invoice.discount_percentage) {
    return (calcTotal(invoice as unknown as Invoice) * Number(invoice.discount)) / 100;
  }
  return Number(invoice.discount || 0);
}

export async function useDownloadPDF(elementId: string, fileName: string): Promise<void> {
  useSeoMeta({ title: fileName });
  setTimeout(() => {
    const element = document.getElementById(elementId);
    if (!element) {
      console.error(`Element with ID "${elementId}" not found.`);
      return;
    }
    const printer = document.getElementById("printableArea");
    if (!printer) {
      console.error('Element with ID "printableArea" not found.');
      return;
    }
    try {
      // FLAG [S8-MITIGATED]: innerHTML bridge kept for print layout; source is app-rendered
      // invoice DOM (Vue-escaped). Do not feed raw user HTML here; product/customer
      // names are interpolated as text by Vue before cloning.
      printer.replaceChildren(...Array.from(element.childNodes).map((n) => n.cloneNode(true)));
      window.print();
      printer.replaceChildren();
      useSeoMeta({ title: "منشئ الفواتير" });
    } catch (error) {
      console.error("Error generating PDF:", error);
    }
  }, 100);
}

export const useHelpers = () => ({
  formatePrice,
  formatDate,
  formatTime12Hour,
  useDownloadPDF,
  calcTotal,
  calcLineTotal,
  discountAmountFor,
});
