import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { prepare, spinePixels } from '../pixels';
import type { ShelfCanvasProps } from '../shelf-canvas';
import { DirectScene } from './scene';

/**
 * The shelf's surface on the web for the renderer written straight on WebGPU: a plain canvas and
 * the browser's own WebGPU. A browser without it has no fallback here as three has in WebGL, so it
 * reports itself unavailable and the shelf is drawn by three.
 */
export function ShelfCanvas({ style, driver, onUnavailable }: ShelfCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let gone = false;
    let scene: DirectScene | undefined;
    const lost = () => {
      if (!gone) onUnavailable();
    };
    (async () => {
      const context = canvas.current?.getContext('webgpu');
      if (!canvas.current || !context || !navigator.gpu) throw new Error('no WebGPU');
      const [started] = await Promise.all([DirectScene.start({ gpu: navigator.gpu, context, canvas: canvas.current, drawSpine: spinePixels, onLost: lost }), prepare()]);
      if (gone) return started.dispose();
      scene = started;
      driver.attach(scene);
    })().catch(lost);
    return () => {
      gone = true;
      driver.attach(null);
      scene?.dispose();
    };
  }, [driver, onUnavailable]);
  return (
    <View style={style}>
      <canvas ref={canvas} style={{ display: 'block', width: '100%', height: '100%' }} />
    </View>
  );
}
