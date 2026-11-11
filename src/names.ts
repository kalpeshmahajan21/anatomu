/**
 * Turn a raw mesh name into something readable.
 *   "Right_femur.r"      -> "Right femur"
 *   "Femur.l"            -> "Left femur"
 *   "Biceps_brachii.001" -> "Biceps brachii"
 */
/**
 * Names that are broken in the source model (Z-Anatomy). We don't guess missing names:
 * a structure without one says so.
 */
const SOURCE_NAME_FIXES: Record<string, string> = {
  '????????': 'Cardiac vein (unnamed in source model)',
  '?x': 'Artery (unnamed in source model)',
  // The source's own note: "Posterior" is the other name of this vein.
  "Inferior vein of left ventricle (//Posterior '')": 'Inferior vein of left ventricle (also called posterior vein)',
  // Abbreviated names of the lateral sulcus (Lat_Fis = lateral fissure) and its branches.
  'Lat_Fis-ant-Vertical': 'Ascending ramus of lateral sulcus',
  'Lat_Fis-ant-Horizont': 'Anterior ramus of lateral sulcus',
  'Lat_Fis-post': 'Posterior ramus of lateral sulcus',
  'Sulcus interm_prim-Jensen': 'Intermediate sulcus of Jensen',
  // The source has the spinal cord's central canal twice; this second copy has no text.
  "Central canal'": 'Central canal (second piece in source model)',
}

export function cleanName(raw: string): string {
  // "(female)" only keeps female versions apart from male ones with the same name (Sacrum).
  let name = raw.replace(/\s*\(female\)/i, '').trim()
  let side: 'Left' | 'Right' | null = null

  // Strip Blender/Z-Anatomy suffixes like ".l", ".r", ".001", ".j" (one or more).
  for (;;) {
    const m = name.match(/\.([a-z0-9]{1,4})$/i)
    if (!m) break
    const s = m[1].toLowerCase()
    if (s === 'l') side = 'Left'
    if (s === 'r') side = 'Right'
    name = name.slice(0, -m[0].length)
  }

  name = SOURCE_NAME_FIXES[name] ?? name
  name = name.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').replace(/^['"]+|['"]+$/g, '').trim() // stray quotes: "Central canal'"

  // Add the side if the name itself doesn't already say it.
  if (side && !/\b(left|right)\b/i.test(name)) {
    name = `${side} ${name.charAt(0).toLowerCase()}${name.slice(1)}`
  }
  return name.charAt(0).toUpperCase() + name.slice(1)
}
