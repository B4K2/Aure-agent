// Flowing monochrome line field rendered in WebGL (inspired by React Bits "Threads").
import { Mesh, Program, Renderer, Triangle } from 'ogl'
import { useEffect, useRef } from 'react'

const vertex = /* glsl */ `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const fragment = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uResolution;
uniform vec2 uMouse;
uniform float uAmplitude;
uniform float uDistance;
varying vec2 vUv;

#define LINES 36.0

float hash(float n) { return fract(sin(n) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0;
  return mix(mix(hash(n), hash(n + 1.0), f.x), mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y);
}

float line(vec2 st, float perc, float offset, vec2 mouse, float t) {
  float split = offset + perc * 0.4;
  float spread = smoothstep(split - 0.6, split + 0.6, st.x) * (1.0 - smoothstep(split + 0.2, split + 1.2, st.x));
  float amp = spread * uAmplitude * (0.35 + (mouse.y - 0.5) * 0.4);
  float y = 0.5 + (perc - 0.5) * uDistance
    + (noise(vec2(t + st.x * 2.2 + perc * 3.0, perc * 5.0 + mouse.x)) - 0.5) * amp;
  float w = 0.0018 + perc * 0.0025;
  float d = abs(st.y - y);
  return smoothstep(w + 0.004, w, d) * (1.0 - perc * 0.55);
}

void main() {
  vec2 st = vUv;
  st.x *= uResolution.x / uResolution.y * 0.6;
  float t = uTime * 0.12;
  float c = 0.0;
  for (float i = 0.0; i < LINES; i++) {
    float p = i / LINES;
    c += line(st, p, 0.25 + p * 0.2, uMouse, t);
  }
  // fade edges so it melts into the page
  float vignette = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
  c *= vignette;
  gl_FragColor = vec4(vec3(1.0), clamp(c, 0.0, 1.0) * 0.9);
}
`

type Props = { amplitude?: number; distance?: number; className?: string }

export default function Threads({ amplitude = 1.4, distance = 0.35, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const renderer = new Renderer({ alpha: true, dpr: Math.min(window.devicePixelRatio, 2) })
    const gl = renderer.gl
    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    el.appendChild(gl.canvas)

    const program = new Program(gl, {
      vertex,
      fragment,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [1, 1, 1] },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uAmplitude: { value: amplitude },
        uDistance: { value: distance },
      },
    })
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program })

    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight)
      program.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height]
    }
    window.addEventListener('resize', resize)
    resize()

    const target = [0.5, 0.5]
    const current = [0.5, 0.5]
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      target[0] = (e.clientX - r.left) / r.width
      target[1] = 1 - (e.clientY - r.top) / r.height
    }
    window.addEventListener('mousemove', onMove)

    let raf = 0
    const loop = (t: number) => {
      current[0] += (target[0] - current[0]) * 0.04
      current[1] += (target[1] - current[1]) * 0.04
      program.uniforms.uMouse.value[0] = current[0]
      program.uniforms.uMouse.value[1] = current[1]
      program.uniforms.uTime.value = t * 0.001
      renderer.render({ scene: mesh })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMove)
      el.removeChild(gl.canvas)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [amplitude, distance])

  return <div ref={ref} className={className} />
}
