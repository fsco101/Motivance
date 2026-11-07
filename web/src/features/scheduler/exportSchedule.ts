/** Everything here is loaded on export only, so none of it reaches the first download. */

export type ExportLine = { date: string; time: string; patient: string; therapist: string; status: string; attendance: string; reference: string }
export type ExportDocument = { center: string; title: string; range: string; generated: string; columns: ExportLine; lines: readonly ExportLine[]; fileName: string }

const KEYS = ['date', 'time', 'patient', 'therapist', 'status', 'attendance', 'reference'] as const

export async function saveXlsx(document: ExportDocument) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const header = KEYS.map((key) => ({ value: document.columns[key], fontWeight: 'bold' as const }))
  // Written as text, so a value that starts with = can never become a formula in someone's spreadsheet.
  const rows = document.lines.map((line) => KEYS.map((key) => ({ value: line[key], type: String })))
  await writeXlsxFile([header, ...rows], { columns: KEYS.map(() => ({ width: 26 })) }).toFile(`${document.fileName}.xlsx`)
}

async function logoData() {
  const response = await fetch('/logo-96.png')
  const blob = await response.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('The logo could not be read'))
    reader.readAsDataURL(blob)
  })
}

export async function savePdf(document: ExportDocument) {
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([import('jspdf'), import('jspdf-autotable'), logoData()])
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  pdf.addImage(logo, 'PNG', 40, 28, 40, 40)
  pdf.setFontSize(16)
  pdf.text(document.center, 90, 44)
  pdf.setFontSize(10)
  pdf.text(`${document.title}: ${document.range}`, 90, 60)
  pdf.text(document.generated, 40, 84)
  autoTable(pdf, {
    startY: 94, margin: { left: 40, right: 40 }, styles: { fontSize: 9 }, headStyles: { fillColor: [14, 124, 134] },
    head: [KEYS.map((key) => document.columns[key])], body: document.lines.map((line) => KEYS.map((key) => line[key])),
  })
  pdf.save(`${document.fileName}.pdf`)
}
