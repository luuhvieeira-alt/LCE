import * as THREE from 'three';

export function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function createAsphaltTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#181C23';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle aggregate grain
  for (let i = 0; i < 4200; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const shade = 20 + Math.floor(Math.random() * 24);
    ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 6})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Subtle tire wear tracks
  ctx.fillStyle = 'rgba(8, 10, 14, 0.25)';
  ctx.fillRect(110, 0, 56, 512);
  ctx.fillRect(346, 0, 56, 512);

  // Double amber center divider
  ctx.fillStyle = '#B87314';
  ctx.fillRect(248, 0, 5, 512);
  ctx.fillRect(259, 0, 5, 512);

  // Outer lane edge lines
  ctx.fillStyle = 'rgba(203, 213, 225, 0.35)';
  ctx.fillRect(26, 0, 6, 512);
  ctx.fillRect(480, 0, 6, 512);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 6);
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}

export function createSidewalkTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#252B36';
  ctx.fillRect(0, 0, 256, 256);

  // Concrete paver slabs
  ctx.strokeStyle = '#171B23';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }

  for (let i = 0; i < 800; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const v = 30 + Math.floor(Math.random() * 22);
    ctx.fillStyle = `rgb(${v}, ${v + 4}, ${v + 10})`;
    ctx.fillRect(x, y, 2, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}

export function createFacadeTexture(
  baseColor: string,
  accentHex: string,
  seed: number,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 512, 512);

  // Vertical structural pilasters
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  for (let x = 0; x < 512; x += 64) {
    ctx.fillRect(x, 0, 10, 512);
  }

  // Horizontal spandrels & illuminated office windows
  let rng = seed * 16807 % 2147483647;
  const nextRand = () => {
    rng = (rng * 48271) % 2147483647;
    return rng / 2147483647;
  };

  for (let row = 0; row < 10; row++) {
    const y = 18 + row * 48;
    ctx.fillStyle = 'rgba(8, 11, 18, 0.55)';
    ctx.fillRect(0, y - 6, 512, 5);

    for (let col = 0; col < 8; col++) {
      const x = 14 + col * 64;
      const r = nextRand();
      if (r > 0.64) {
        // Warm lit interior office
        ctx.fillStyle = r > 0.88 ? accentHex : '#E0B268';
        ctx.globalAlpha = 0.45 + nextRand() * 0.4;
      } else if (r > 0.35) {
        // Cool twilight reflection glass
        ctx.fillStyle = '#314461';
        ctx.globalAlpha = 0.65;
      } else {
        // Unlit dark curtain glass
        ctx.fillStyle = '#0D131F';
        ctx.globalAlpha = 0.92;
      }
      ctx.fillRect(x, y, 42, 30);
      ctx.globalAlpha = 1;

      // Subtle window mullion
      ctx.fillStyle = 'rgba(10, 14, 22, 0.6)';
      ctx.fillRect(x + 20, y, 2, 30);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.25)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
