// pdf-parse ships no types. Declaring the sliver we use is honest and costs
// nothing; pulling in @types/pdf-parse for one function would not be.
declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string
    numpages: number
    info?: { Title?: string; Author?: string }
  }
  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>
  export default pdfParse
}
