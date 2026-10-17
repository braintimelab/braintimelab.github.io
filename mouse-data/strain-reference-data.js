/* Public reference stocks checked against JAX and MGI, 2026-10-18.
 * Catalog backgrounds describe the reference stock, not the lab's crosses.
 * These defaults never change animal genotypes or replace saved strain fields. */
const entry=(stock,fields)=>Object.freeze({stock,url:`https://www.jax.org/strain/${stock}`,checked_at:'2026-10-18',fields:Object.freeze(fields)});
export const JAX_STRAIN_REFERENCES=Object.freeze({
 P:entry('006852',{
  insertion_type:'knock_in',formal_name:'B6.129S6-Per2tm1Jt/J',gene_symbol:'Per2',allele_symbol:'Per2tm1Jt',
  construct:'Luciferase and a floxed selection cassette were targeted after exon 23, producing a PER2–luciferase fusion.',
  reporter:'PER2::LUC (luciferase fusion)',catalog_background:'B6 congenic; 129S6-derived targeted allele',
  strain_source:'The Jackson Laboratory (reference stock)',stock_reference:'JAX 006852',
  genotyping_notes:'JAX PCR protocol 22955. Validate with the local stock and appropriate controls.',
  references:'https://www.jax.org/strain/006852\nhttps://www.informatics.jax.org/allele/MGI:3040876\nhttps://www.jax.org/Protocol?protocolID=22955&stockNumber=006852'
 }),
 B:entry('007668',{
  insertion_type:'knock_in',formal_name:'B6.129S4(Cg)-Bmal1tm1Weit/J',gene_symbol:'Bmal1 (formerly Arntl)',allele_symbol:'Bmal1tm1Weit (legacy Arntltm1Weit)',
  construct:'Conditional allele with loxP sites around exon 8. The FRT-flanked selection cassette was removed with Flpe.',
  catalog_background:'B6 congenic; 129S4-derived targeted allele',strain_source:'The Jackson Laboratory (reference stock)',stock_reference:'JAX 007668',
  genotyping_notes:'JAX probe/qPCR protocol 22021 uses known zygosity controls; this is not an endpoint gel assay.',
  references:'https://www.jax.org/strain/007668\nhttps://www.informatics.jax.org/allele/MGI:3720808\nhttps://www.jax.org/Protocol?protocolID=22021&stockNumber=007668'
 }),
 V:entry('010908',{
  insertion_type:'knock_in',formal_name:'STOCK Viptm1(cre)Zjh/J',gene_symbol:'Vip',allele_symbol:'Viptm1(cre)Zjh',promoter:'Endogenous Vip promoter and enhancers',
  construct:'IRES-Cre and a polyadenylation signal were targeted to the Vip 3′ UTR; the selection cassette was removed.',recombinase:'Cre',
  catalog_background:'Mixed STOCK background; distinct from B6J-backcrossed JAX 031628',strain_source:'The Jackson Laboratory (reference stock)',stock_reference:'JAX 010908',
  genotyping_notes:'JAX PCR protocol 29387 specifies Hotstart Taq. Validate with local controls.',
  references:'https://www.jax.org/strain/010908\nhttps://www.informatics.jax.org/allele/MGI:4431361\nhttps://www.jax.org/Protocol?protocolID=29387&stockNumber=010908'
 }),
 F:entry('027012',{
  insertion_type:'knock_in',formal_name:'STOCK Foxj1tm1.1(cre/ERT2/GFP)Htg/J',gene_symbol:'Foxj1',allele_symbol:'Foxj1tm1.1(cre/ERT2/GFP)Htg',
  promoter:'Endogenous Foxj1 regulatory sequences',
  construct:'GFP-CreERT2 cassette targeted to exon 2 before the translation start site; the FRT-flanked neomycin cassette was removed with Flp.',
  reporter:'GFP',recombinase:'Tamoxifen-inducible CreERT2',catalog_background:'Mixed STOCK reference background; targeted allele derived from 129P2/OlaHsd ES cells',
  strain_source:'The Jackson Laboratory',stock_reference:'JAX 027012',
  genotyping_notes:'JAX separated PCR protocol 17668: mutant 294 bp; wild type 472 bp. Validate with local controls. Genotype alone does not establish tamoxifen treatment or recombination.',
  references:'https://www.jax.org/strain/027012\nhttps://www.informatics.jax.org/allele/MGI:5585638\nhttps://www.jax.org/Protocol?protocolID=17668&stockNumber=027012'
 }),
 A:entry('023530',{
  insertion_type:'knock_in',formal_name:'B6.Cg-Avptm1.1(cre)Hze/J',gene_symbol:'Avp',allele_symbol:'Avptm1.1(cre)Hze',
  promoter:'Endogenous Avp regulatory sequences',
  construct:'IRES2-Cre targeted after the endogenous stop codon in exon 3; the AttB/AttP-flanked PGK-neo cassette was removed using PhiC31.',
  recombinase:'Cre',catalog_background:'B6 congenic reference stock; targeted allele derived from (129S6/SvEvTac x C57BL/6NCrl)F1 ES cells',
  strain_source:'The Jackson Laboratory',stock_reference:'JAX 023530 (AVP-IRES2-Cre-D)',
  genotyping_notes:'JAX separated PCR protocol 26345: mutant 243 bp; wild type 247 bp. Use the separate reactions and validate locally; do not infer zygosity from one unresolved band.',
  references:'https://www.jax.org/strain/023530\nhttps://www.informatics.jax.org/allele/MGI:5522761\nhttps://www.jax.org/Protocol?protocolID=26345&stockNumber=023530'
 }),
 '96':entry('028866',{
  insertion_type:'knock_in',formal_name:'B6J.Cg-Gt(ROSA)26Sortm96(CAG-GCaMP6s)Hze/MwarJ',gene_symbol:'Gt(ROSA)26Sor',allele_symbol:'Gt(ROSA)26Sortm96(CAG-GCaMP6s)Hze',
  promoter:'CAG (CMV enhancer, chicken beta-actin and rabbit beta-globin hybrid)',
  construct:'Rosa26-targeted loxP-STOP-loxP-GCaMP6s-WPRE cassette; Cre removes the STOP to activate the calcium reporter.',reporter:'GCaMP6s',
  catalog_background:'C57BL/6J congenic; distinct from mixed-background JAX 024106',strain_source:'The Jackson Laboratory (reference stock)',stock_reference:'JAX 028866',
  genotyping_notes:'JAX PCR protocol 19604. The recorded Cryopreservation name identifies the C57BL/6J reference stock.',
  references:'https://www.jax.org/strain/028866\nhttps://www.informatics.jax.org/allele/MGI:5558094\nhttps://www.jax.org/Protocol?protocolID=19604&stockNumber=028866'
 }),
 '32':entry('012569',{
  insertion_type:'knock_in',formal_name:'B6;129S-Gt(ROSA)26Sortm32(CAG-COP4*H134R/EYFP)Hze/J',gene_symbol:'Gt(ROSA)26Sor',allele_symbol:'Gt(ROSA)26Sortm32(CAG-COP4*H134R/EYFP)Hze',
  promoter:'CAG (CMV enhancer, chicken beta-actin and rabbit beta-globin hybrid)',
  construct:'Rosa26-targeted loxP-STOP-loxP-ChR2(H134R)-EYFP-WPRE cassette; Cre activates the channelrhodopsin fusion.',reporter:'ChR2(H134R)-EYFP',
  catalog_background:'Mixed C57BL/6 and 129S reference stock',strain_source:'The Jackson Laboratory (reference stock)',stock_reference:'JAX 012569 (Ai32 reference)',
  genotyping_notes:'JAX shared PCR protocol 18556 includes stock-specific notes for 012569. Confirm the local stock before applying an assay.',
  references:'https://www.jax.org/strain/012569\nhttps://www.informatics.jax.org/allele/MGI:5013789\nhttps://www.jax.org/Protocol?protocolID=18556&stockNumber=033753'
 }),
 AD:entry('005864',{
  insertion_type:'transgenic',formal_name:'B6.Cg-Tg(APPswe,PSEN1dE9)85Dbo/Mmjax',gene_symbol:'APP; PSEN1',allele_symbol:'Tg(APPswe,PSEN1dE9)85Dbo',promoter:'Mouse Prnp (prion protein) promoter for both transgenes',
  construct:'Mutant APPswe and PSEN1dE9 transgenes are co-integrated at one chromosome 9 insertion site.',
  catalog_background:'B6 congenic reference stock',strain_source:'The Jackson Laboratory / MMRRC (reference stock)',stock_reference:'JAX 005864; MMRRC 034832-JAX',
  genotyping_notes:'JAX protocol 33897 identifies the transgene. It does not measure copy number; its homozygote assessment was not validated on homozygous samples.',
  references:'https://www.jax.org/strain/005864\nhttps://www.informatics.jax.org/allele/MGI:3524957\nhttps://www.jax.org/protocol?protocolid=33897&stocknumber=005864'
 })
});
