/**
 * styles.xml for Falcon-written files, using Verbatim's style ids and names so Verbatim's macros
 * and Word's navigation pane treat the file like any other Verbatim file.
 * Sizes are half-points (w:sz 22 = 11pt).
 */
export const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
  <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
  <w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:aliases w:val="Pocket"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:pBdr><w:top w:val="single" w:sz="18" w:space="1" w:color="auto"/><w:left w:val="single" w:sz="18" w:space="4" w:color="auto"/><w:bottom w:val="single" w:sz="18" w:space="1" w:color="auto"/><w:right w:val="single" w:sz="18" w:space="4" w:color="auto"/></w:pBdr><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="52"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:aliases w:val="Hat"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:jc w:val="center"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="44"/><w:szCs w:val="26"/><w:u w:val="double"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:aliases w:val="Block"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:jc w:val="center"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="24"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:aliases w:val="Tag"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="40"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:iCs/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Analytic"><w:name w:val="Analytic"/><w:basedOn w:val="Heading4"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:color w:val="1F3F8A"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Undertag"><w:name w:val="Undertag"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:color w:val="2A6A3A"/></w:rPr></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="Style13ptBold"><w:name w:val="Style 13 pt Bold"/><w:aliases w:val="Cite"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="1"/><w:qFormat/><w:rPr><w:b/><w:bCs/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="StyleUnderline"><w:name w:val="Style Underline"/><w:aliases w:val="Underline"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="1"/><w:qFormat/><w:rPr><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="7"/><w:qFormat/><w:rPr><w:b/><w:iCs/><w:u w:val="single"/><w:bdr w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:rPr></w:style>
</w:styles>`;
