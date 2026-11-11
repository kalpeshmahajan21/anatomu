import { Color, DataTexture, FrontSide, MeshStandardMaterial, NearestFilter, RGBAFormat, ShaderMaterial, type IUniform } from 'three'

/**
 * One texel per structure (part id -> x = id % 256, y = id / 256):
 *   red = selected (one part, or every part of a whole structure), green = hovered.
 * The shaders read it, so selecting the whole heart is one texture upload, not 17 uniforms.
 */
export const MASK_W = 256
export const MASK_H = 16 // room for 4096 structures
const maskData = new Uint8Array(MASK_W * MASK_H * 4)
export const selMask = new DataTexture(maskData, MASK_W, MASK_H, RGBAFormat)
selMask.magFilter = selMask.minFilter = NearestFilter
selMask.needsUpdate = true
const marked = { sel: [] as number[], hov: [] as number[] }

/** Mark which parts are selected and hovered (replaces the previous marks). */
export function setMask(sel: number[], hov: number[]) {
  if (same(sel, marked.sel) && same(hov, marked.hov)) return
  for (const id of marked.sel) maskData[id * 4] = 0
  for (const id of marked.hov) maskData[id * 4 + 1] = 0
  for (const id of sel) if (id >= 0 && id < MASK_W * MASK_H) maskData[id * 4] = 255
  for (const id of hov) if (id >= 0 && id < MASK_W * MASK_H) maskData[id * 4 + 1] = 255
  marked.sel = sel.slice()
  marked.hov = hov.slice()
  selMask.needsUpdate = true
}
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i])
export const isMarkedSelected = (id: number) => maskData[id * 4] > 0

/**
 * Uniforms shared by every layer's materials. Changing a value here updates all
 * layers at once, with no React re-render and no material rebuild.
 * Ids are global part ids; -1 means "none".
 */
export const sharedUniforms = {
  uSelMask: { value: selMask },
  /** Focus mode (1/0): the selection is drawn solid, everything else as glass. */
  uFocusOn: { value: 0 },
  /** Isolate (1/0): only the selection is drawn. */
  uIsolateOn: { value: 0 },
  /** Body shown: 1 = male, 2 = female (matches the per-vertex `sex` attribute). */
  uSex: { value: 1 },
  uGlowColor: { value: new Color('#8fd0ff') },
  uEdgeColor: { value: new Color('#7fe3ff') },
}

type LayerUniforms = { uReveal: IUniform<number> }

// Small GLSL helpers shared by both materials.
const HIDE_VERTEX = /* glsl */ `
  // Hide a whole structure by pushing its vertices outside the screen. All 3 corners
  // land on the same point, so the GPU drops the triangle before it costs any pixels.
  #define HIDE_IF(cond) if (cond) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  // Selected / hovered marks of this vertex's structure (see selMask).
  #define MASK() texelFetch(uSelMask, ivec2(int(partId + 0.5) % ${MASK_W}, int(partId + 0.5) / ${MASK_W}), 0)
  // Structures of the other body (Male/Female switch): sex 0 = both, 1 = male, 2 = female.
  #define OTHER_SEX (sex > 0.5 && abs(sex - uSex) > 0.5)
`

/**
 * The normal, solid look: a lit material with per-structure colours (vertex colours),
 * plus a small shader patch that
 *  - hides structures (isolate mode, focus mode),
 *  - adds a soft glow (flat tint + brighter rim) to the hovered / selected structure,
 *  - cuts the layer at a height for the Build animation, with a glowing edge.
 */
export function createAnatomyMaterial(roughness: number, layer: LayerUniforms) {
  const mat = new MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness, metalness: 0 })

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms, layer)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         ${HIDE_VERTEX}
         attribute float partId;
         attribute float sex;
         uniform sampler2D uSelMask;
         uniform float uIsolateOn;
         uniform float uFocusOn;
         uniform float uSex;
         varying float vSel;
         varying float vHov;
         varying float vWorldY;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vec4 marks = MASK();
         vSel = marks.r;
         vHov = marks.g;
         vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;
         HIDE_IF(OTHER_SEX)
         HIDE_IF(uIsolateOn > 0.5 && vSel < 0.5)
         HIDE_IF(uFocusOn > 0.5 && vSel < 0.5)`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uReveal;
         uniform vec3 uGlowColor;
         uniform vec3 uEdgeColor;
         varying float vSel;
         varying float vHov;
         varying float vWorldY;`,
      )
      .replace(
        'void main() {',
        `void main() {
         if (vWorldY > uReveal) discard; // Build animation: not revealed yet`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           float isHover = step(0.5, vHov);
           float isSel = step(0.5, vSel);
           float rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.0);
           float glow = max(isHover * (0.16 + 0.7 * rim), isSel * (0.10 + 0.6 * rim));
           totalEmissiveRadiance += uGlowColor * glow;
           // Bright band just under the Build animation's reveal line.
           float edge = 1.0 - smoothstep(0.0, 0.035, uReveal - vWorldY);
           totalEmissiveRadiance += uEdgeColor * edge * 1.6;
         }`,
      )
  }
  return mat
}

/**
 * The "glass" look used for everything around the focused structure (and for parts the
 * Build animation hasn't revealed yet): faint, see-through, brighter at the silhouette.
 * It's a second draw of the same geometry, only switched on while it's needed.
 */
export function createGhostMaterial(layer: LayerUniforms) {
  return new ShaderMaterial({
    uniforms: { ...sharedUniforms, ...layer },
    transparent: true,
    depthWrite: false,
    side: FrontSide,
    vertexShader: /* glsl */ `
      ${HIDE_VERTEX}
      attribute float partId;
      attribute float sex;
      uniform sampler2D uSelMask;
      uniform float uIsolateOn;
      uniform float uFocusOn;
      uniform float uSex;
      varying float vHov;
      varying float vWorldY;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * world;
        vec4 marks = MASK();
        vHov = marks.g;
        vWorldY = world.y;
        vNormal = normalize(normalMatrix * normal);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
        HIDE_IF(OTHER_SEX)
        HIDE_IF(uIsolateOn > 0.5)                 // isolate = nothing else at all
        HIDE_IF(uFocusOn > 0.5 && marks.r > 0.5) // the selection is drawn solid instead
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFocusOn;
      uniform float uReveal;
      uniform vec3 uGlowColor;
      varying float vHov;
      varying float vWorldY;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // Without focus mode, glass only stands in for not-yet-revealed parts.
        if (uFocusOn < 0.5 && vWorldY <= uReveal) discard;
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.5);
        float hover = step(0.5, vHov);
        vec3 col = mix(vec3(0.62, 0.68, 0.78), uGlowColor, hover);
        float alpha = 0.025 + 0.2 * rim + hover * 0.18;
        gl_FragColor = vec4(col, alpha);
      }`,
  })
}
