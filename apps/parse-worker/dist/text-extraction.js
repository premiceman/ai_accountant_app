"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractText = extractText;
const parse_1 = require("@fast-csv/parse");
const fast_xml_parser_1 = require("fast-xml-parser");
const mammoth_1 = __importDefault(require("mammoth"));
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const utils_1 = require("./utils");
async function extractPdf(buffer) {
    const result = await (0, pdf_parse_1.default)(buffer);
    return (0, utils_1.normaliseWhitespace)(result.text || '');
}
async function extractDocx(buffer) {
    const result = await mammoth_1.default.extractRawText({ buffer });
    return (0, utils_1.normaliseWhitespace)(result.value || '');
}
async function extractTxt(buffer) {
    return (0, utils_1.normaliseWhitespace)(buffer.toString('utf8'));
}
async function extractCsv(buffer) {
    const rows = [];
    await new Promise((resolve, reject) => {
        (0, parse_1.parseString)(buffer.toString('utf8'), { trim: true })
            .on('error', reject)
            .on('data', (row) => {
            rows.push(row.join(' '));
        })
            .on('end', () => resolve());
    });
    return (0, utils_1.normaliseWhitespace)(rows.join('\n'));
}
async function extractXml(buffer) {
    const parser = new fast_xml_parser_1.XMLParser({ ignoreDeclaration: true, ignoreAttributes: false });
    const content = parser.parse(buffer.toString('utf8'));
    return (0, utils_1.normaliseWhitespace)(JSON.stringify(content));
}
async function extractText(buffer, docType) {
    const normalizedType = (docType || '').toUpperCase();
    if (normalizedType.includes('PDF'))
        return extractPdf(buffer);
    if (normalizedType.includes('DOCX') || normalizedType.includes('WORD'))
        return extractDocx(buffer);
    if (normalizedType.includes('CSV'))
        return extractCsv(buffer);
    if (normalizedType.includes('XML'))
        return extractXml(buffer);
    return extractTxt(buffer);
}
