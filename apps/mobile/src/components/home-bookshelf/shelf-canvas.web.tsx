import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import * as THREE from 'three/webgpu';

import type { ShelfCanvasProps } from './shelf-canvas';
import { drawSpine } from './pictures';
import { ShelfScene } from './scene';

/**
 * The shelf's surface on the web: a plain canvas, which three's renderer draws to with the
 * browser's WebGPU, or with WebGL 2 where there is none — which is why this is not
 * react-native-webgpu's canvas, whose web build has only the first.
 */
export function ShelfCanvas({ style, driver, onUnavailable }: ShelfCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let gone = false;
    let renderer: THREE.WebGPURenderer | undefined;
    let scene: ShelfScene | undefined;
    (async () => {
      if (!canvas.current) throw new Error('no canvas');
      renderer = new THREE.WebGPURenderer({ antialias: true, canvas: canvas.current });
      await renderer.init();
      if (gone) return;
      scene = new ShelfScene(renderer, drawSpine);
      driver.attach(scene);
    })().catch(() => {
      if (!gone) onUnavailable();
    });
    return () => {
      gone = true;
      driver.attach(null);
      scene?.dispose();
      renderer?.dispose();
    };
  }, [driver, onUnavailable]);
  return (
    <View style={style}>
      <canvas ref={canvas} style={{ display: 'block', width: '100%', height: '100%' }} />
    </View>
  );
}
