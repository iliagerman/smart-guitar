/**
 * The Smart Guitar mark, animated: the burning-guitar artwork with its
 * flames licking upward, shimmering with heat, and sparks drifting off it.
 *
 * One shared WebGL renderer draws the artwork once per frame; every mounted
 * logo copies that frame into its own 2D canvas. Any number of logos on a page
 * therefore cost one small shader pass, and never exhaust the browser's
 * WebGL context limit. The artwork's black background becomes transparent.
 *
 * Also bundled for the landing page (homepage/js/flame-logo.min.js).
 */

export interface FlameLogoOptions {
  /** The artwork (square, black background, 1024 px, same origin). */
  src: string
}

interface Instance {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  visible: boolean
}

const MAX_RES = 768

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uArt;
uniform float uTime;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
float luma(vec3 c) { return max(c.r, max(c.g, c.b)); }

void main() {
  vec2 uv = vUv;
  float t = uTime;
  // How much fire is here: the flames are the bright parts of the art.
  float fire = smoothstep(0.12, 0.55, luma(texture2D(uArt, uv, 2.0).rgb));
  // Sample from a little below, by a noisy amount scrolling upward: the
  // flames lick up and sway, while the dark guitar itself stays still.
  float n1 = fbm(vec2(uv.x * 7.0, uv.y * 4.0 - t * 1.6));
  float n2 = fbm(vec2(uv.x * 13.0 + 4.0, uv.y * 7.0 - t * 2.6));
  vec2 lick = vec2((n1 - 0.5) * 0.018, -0.022 * n2) * fire;
  vec3 col = texture2D(uArt, uv + lick).rgb;
  // Flicker, and a breathing glow from the blurred artwork.
  col *= mix(1.0, 0.8 + 0.45 * fbm(vec2(uv.x * 5.0, uv.y * 3.0 - t * 1.2)), fire);
  vec3 glow = texture2D(uArt, uv + vec2(0.0, -0.02), 6.0).rgb;
  col += glow * vec3(1.0, 0.45, 0.12) * (0.35 + 0.2 * sin(t * 2.3) * n1);

  // Sparks: one per grid cell, drifting up from the flames.
  vec2 g = vec2(uv.x * 22.0, uv.y * 14.0 - t * 1.7);
  vec2 id = floor(g);
  vec2 cell = fract(g) - 0.5;
  vec2 at = vec2(hash(id + 1.3) - 0.5, hash(id + 7.1) - 0.5) * 0.6;
  float spark = smoothstep(0.09, 0.0, length(cell - at)) * step(0.82, hash(id));
  spark *= smoothstep(0.05, 0.4, luma(texture2D(uArt, uv - vec2(0.0, 0.12), 5.0).rgb));
  col += vec3(1.0, 0.62, 0.22) * spark * (0.6 + 0.4 * sin(t * 6.0 + id.x));

  // Black and the dim smoke around the guitar become transparent, and the
  // art fades out in a tall oval, so no box ever shows behind the fire.
  col *= smoothstep(0.5, 0.38, length((uv - 0.5) * vec2(1.0, 0.82)));
  float a = smoothstep(0.16, 0.55, luma(col));
  gl_FragColor = vec4(min(col, vec3(a)), a);
}`

class Renderer {
  readonly canvas: HTMLCanvasElement
  private gl: WebGLRenderingContext
  private uTime: WebGLUniformLocation
  private instances = new Set<Instance>()
  private observer: IntersectionObserver
  private raf = 0
  private ready = false
  private start = performance.now()
  private still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext, src: string) {
    this.canvas = canvas
    this.gl = gl
    const program = gl.createProgram()!
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, source)
      gl.compileShader(s)
      gl.attachShader(program, s)
    }
    shader(gl.VERTEX_SHADER, VERT)
    shader(gl.FRAGMENT_SHADER, FRAG)
    gl.linkProgram(program)
    gl.useProgram(program)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.uniform1i(gl.getUniformLocation(program, 'uArt'), 0)
    this.uTime = gl.getUniformLocation(program, 'uTime')!

    const img = new Image()
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      // mipmaps give the shader cheap blurred copies for the glow and masks
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.ready = true
      this.schedule()
    }
    img.src = src

    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        for (const inst of this.instances) if (inst.canvas === e.target) inst.visible = e.isIntersecting
      }
      this.schedule()
    })
    document.addEventListener('visibilitychange', () => this.schedule())
  }

  add(inst: Instance) {
    this.instances.add(inst)
    this.observer.observe(inst.canvas)
  }

  remove(inst: Instance) {
    this.instances.delete(inst)
    this.observer.unobserve(inst.canvas)
  }

  private schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    this.raf = 0
    const visible = [...this.instances].filter((i) => i.visible)
    if (!this.ready || !visible.length || document.hidden) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let res = 64
    for (const inst of visible) {
      const px = Math.ceil(inst.canvas.clientWidth * dpr)
      if (inst.canvas.width !== px) inst.canvas.width = inst.canvas.height = px
      res = Math.max(res, px)
    }
    res = Math.min(MAX_RES, Math.ceil(res / 64) * 64)
    if (this.canvas.width !== res) {
      this.canvas.width = this.canvas.height = res
      this.gl.viewport(0, 0, res, res)
    }
    this.gl.uniform1f(this.uTime, this.still ? 2.4 : (now - this.start) / 1000)
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4)
    for (const inst of visible) {
      inst.ctx.clearRect(0, 0, inst.canvas.width, inst.canvas.height)
      inst.ctx.drawImage(this.canvas, 0, 0, inst.canvas.width, inst.canvas.height)
    }
    if (!this.still) this.schedule()
  }
}

let shared: Renderer | null | undefined

function renderer(src: string): Renderer | null {
  if (shared !== undefined) return shared
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false })
  shared = gl ? new Renderer(canvas, gl, src) : null
  return shared
}

/**
 * Starts the animated logo in `canvas` (size it with CSS; it stays square).
 * Returns a function that stops it. Without WebGL it shows the still artwork.
 */
export function mountFlameLogo(canvas: HTMLCanvasElement, { src }: FlameLogoOptions): () => void {
  const r = renderer(src)
  const ctx = canvas.getContext('2d')!
  if (!r) {
    const img = new Image()
    img.onload = () => {
      canvas.width = canvas.height = img.naturalWidth
      ctx.drawImage(img, 0, 0)
    }
    img.src = src
    return () => {}
  }
  const inst: Instance = { canvas, ctx, visible: false }
  r.add(inst)
  return () => r.remove(inst)
}
