import * as Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';
import { GameController } from './game/controller';
import { FarmScene } from './game/FarmScene';
import './style.css';
import { mountHud } from './ui/hud';

const controller = new GameController(window.localStorage);
const scene = new FarmScene(controller);

mountHud(document.getElementById('app')!, controller, () => {
  controller.reset();
  scene.refreshWorld();
});

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#f7f1e3',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  render: { antialias: true },
  scene,
});

controller.resumeFromSave();

const saveNow = () => controller.save();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow();
  else controller.tick();
});
window.addEventListener('pagehide', saveNow);

registerSW({ immediate: true });

if (import.meta.env.DEV) Object.assign(window, { farm: controller });
