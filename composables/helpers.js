
function formatePrice(price) {
  if (!import.meta.client) return price;
  let formatter = {
    format: (price) => `${price}`,
  };
  if (Intl && Intl.NumberFormat) {
    formatter = new Intl.NumberFormat(`ar-US`, {
      currencyDisplay: 'symbol',
      currencySign: 'standard',
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      localeMatcher: 'best fit',
      style: 'decimal',
    });
    formatter.format(price);
  }
  return formatter.format(price);
}
function formatDate(date, options) {
  if (!date) return "-";
  try {
    const optionsList = {
      month: "numeric",
      year: "numeric",
      day: "2-digit",
    };
    if (options && options.time === false) {
      delete optionsList.hour12;
      delete optionsList.hour;
      delete optionsList.minute;
    }
    const formatter = new Intl.DateTimeFormat("ar", optionsList);
    return formatter.format(new Date(date));
  } catch (e) {
    return date||'';
  }
}
function formatTime12Hour(date) {
  let hours;
  let minutes;
  if (date instanceof Date) {
    hours = date.getHours();
    minutes = date.getMinutes();
  } else if (typeof date === "string") {
    if (date.includes('م') || date.includes('ص')) return date;
    if (date.includes('GMT+0200')) {
      date = new Date(date);
      hours = date.getHours();
      minutes = date.getMinutes();
    } else {
      hours = (date.split(":")[0] || "00").replace(/[^\d:]/g, '');
      minutes = (date.split(":")[1] || "00").replace(/[^\d:]/g, '');
    }
  }
  const ampm = Number(hours) >= 12 ? "م" : "ص";

  // Convert to 12-hour format
  hours = hours % 12;
  hours = hours ? hours : 12; // The hour '0' should be '12'

  // Pad minutes with leading zero if needed
  const minutesFormatted = minutes < 10 ? "0" + minutes : minutes;

  return `${hours}:${minutesFormatted} ${ampm}`;
}
function calcTotal(invoiceData) {
  return (
    Number(
      invoiceData?.products
        .map((el) => Number(el.product_price) * Number(el.product_quantity))
        .reduce((prev, current) => prev + current, 0) || 0
    ) +
    Number(invoiceData.debt || 0) +
    Number(invoiceData.amount_of_animal_feeds || 0) +
    Number(invoiceData.amount_of_mahros || 0) +
    Number(invoiceData.delivery_price || 0)
  );
}
async function useDownloadPDF(elementId, fileName) {
  useSeoMeta({
    title: fileName
  })
  setTimeout(() => {
    
    const element = document.getElementById(elementId);
    if (!element) {
      console.error(`Element with ID "${elementId}" not found.`);
      return;
    }
    const printer = document.getElementById("printableArea");
    try {
      printer.innerHTML = element.innerHTML;
      window.print();
      printer.innerHTML = '';
      useSeoMeta({
        title:"منشئ الفواتير"
      })
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
  calcTotal
})