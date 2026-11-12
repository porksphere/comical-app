import { useEffect, useRef } from 'react';
import { Canvas, type CanvasRef } from 'react-native-webgpu';

import { prepare, spinePixels } from '../pixels';
import type { ShelfCanvasProps } from '../shelf-canvas';
import { DirectScene } from './scene';

/**
 * The shelf's surface on iOS and Android for the renderer written straight on WebGPU: the same
 * canvas three's draws to (Dawn, over Metal and Vulkan), with no three on it. A frame reaches the
 * screen only when it is presented, which a browser does for a canvas and nothing does here.
 */
export function ShelfCanvas({ style, driver, onUnavailable }: ShelfCanvasProps) {
  const canvas = useRef<CanvasRef>(null);
  useEffect(() => {
    let gone = false;
    let scene: DirectScene | undefined;
    const lost = () => {
      if (!gone) onUnavailable();
    };
    (async () => {
      const context = canvas.current?.getContext('webgpu');
      if (!context) throw new Error('no WebGPU context');
      const [started] = await Promise.all([
        DirectScene.start({ gpu: navigator.gpu, context, canvas: context.canvas, drawSpine: spinePixels, present: () => context.present(), onLost: lost }),
        prepare(),
      ]);
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
  return <Canvas ref={canvas} style={style} />;
}
