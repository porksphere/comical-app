import { useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Canvas, type CanvasRef } from 'react-native-webgpu';
import * as THREE from 'three/webgpu';

import type { ShelfDriver } from './driver';
import { drawSpine, prepare } from './pictures';
import { ShelfScene } from './scene';

export type ShelfCanvasProps = {
  style?: StyleProp<ViewStyle>;
  driver: ShelfDriver;
  /** The renderer could not start on this device. */
  onUnavailable: () => void;
};

/**
 * The shelf's surface on iOS and Android: a WebGPU canvas (Dawn, over Metal and Vulkan) with
 * three's renderer on it. A frame reaches the screen only when it is presented, which a browser
 * does for a canvas and nothing does here.
 */
export function ShelfCanvas({ style, driver, onUnavailable }: ShelfCanvasProps) {
  const canvas = useRef<CanvasRef>(null);
  useEffect(() => {
    let gone = false;
    let renderer: THREE.WebGPURenderer | undefined;
    let scene: ShelfScene | undefined;
    (async () => {
      const context = canvas.current?.getContext('webgpu');
      if (!context) throw new Error('no WebGPU context');
      renderer = new THREE.WebGPURenderer({
        antialias: true,
        canvas: context.canvas as unknown as HTMLCanvasElement,
        context: context as unknown as GPUCanvasContext,
      });
      await Promise.all([renderer.init(), prepare()]);
      if (gone) return;
      scene = new ShelfScene(renderer, drawSpine, () => context.present());
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
  return <Canvas ref={canvas} style={style} />;
}
