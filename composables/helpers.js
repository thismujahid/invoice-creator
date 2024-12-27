import html2canvas from "html2canvas";
import jsPDF from "jspdf";

function formatePrice(price) {
    if (!import.meta.client) return price;
    let formatter = {
      format: (price) => `ج.م. ${price}`,
    };
    if (Intl && Intl.NumberFormat) {
      formatter = new Intl.NumberFormat(`ar-US`, {
        currency: 'EGP',
        currencyDisplay: 'symbol',
        currencySign: 'standard',
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
        localeMatcher: 'best fit',
        style: 'currency',
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
      return date;
    }
  }
  function formatTime12Hour(date) {
    let hours;
    let minutes;
    if (date instanceof Date) {
      hours = date.getHours();
      minutes = date.getMinutes();
    } else if (typeof date === "string") {
      hours = date.split(":")[0] || "00";
      minutes = date.split(":")[1] || "00";
    }
    const ampm = Number(hours) >= 12 ? "م" : "ص";
  
    // Convert to 12-hour format
    hours = hours % 12;
    hours = hours ? hours : 12; // The hour '0' should be '12'
  
    // Pad minutes with leading zero if needed
    const minutesFormatted = minutes < 10 ? "0" + minutes : minutes;
  
    return `${hours}:${minutesFormatted} ${ampm}`;
  }
 async function useDownloadPDF(elementId, fileName) {
    const element = document.getElementById(elementId);
    if (!element) {
      console.error(`Element with ID "${elementId}" not found.`);
      return;
    }
  
    try {
      const canvas = await html2canvas(element, {
        backgroundColor: "#fff",
      });
      const imgData = canvas.toDataURL("image/png");
  
  
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "px",
        format: [canvas.width, canvas.height],
      });
  
      pdf.addImage(imgData, "JPG", 0, 0, canvas.width, canvas.height, "SLOW", "SLOW");
      console.log("🚀 ~ useDownloadPDF ~ canvas.width:", canvas.width)
  
      pdf.save(`${fileName}.pdf`);
    } catch (error) {
      console.error("Error generating PDF:", error);
    }
  }
  export const useHelpers = ()=> ({
    formatePrice,
    formatDate,
    formatTime12Hour,
    useDownloadPDF
  })