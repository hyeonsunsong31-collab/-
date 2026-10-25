import * as THREE from 'three';
import { Character } from '../character/Character.ts';
import type { Look } from '../character/Looks.ts';
import type { Lighting } from '../render/Lighting.ts';
import type { World } from '../world/World.ts';
import type { CompiledClip } from '../animation/Clip.ts';
import type { Combatant } from '../combat/Combatant.ts';

const _v = new THREE.Vector3();

/**
 * A standing townsperson you can talk to (arena heralds). Holds its post and idles; when the player walks up it
 * follows them with its eyes and head and greets them with a bow, then offers its interaction.
 */
export class Npc {
  readonly char: Character;
  readonly pos = new THREE.Vector3();
  yaw: number;
  /** Interaction radius (m). */
  reach = 3.2;
  private greetCooldown = 0;
  private wasNear = false;

  constructor(
    look: Look,
    lighting: Lighting,
    clips: Map<string, CompiledClip>,
    private world: World,
    pos: THREE.Vector3,
    yaw: number,
    readonly name: string,
    readonly role: string,
    readonly idleClip = 'herald_idle',
    readonly greetClip: string | null = 'herald_greet',
  ) {
    this.char = new Character(look, lighting, clips);
    this.pos.copy(pos);
    this.yaw = yaw;
    this.char.animator.setLoco({ [idleClip]: 1 }, 0);
  }

  distanceTo(c: Combatant): number {
    return Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z);
  }

  canTalk(c: Combatant): boolean {
    return c.alive && this.distanceTo(c) < this.reach && Math.abs(c.pos.y - this.pos.y) < 2;
  }

  /** Point above the head for prompts. */
  head(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos).setY(this.pos.y + this.char.look.proportions.height + 0.45);
  }

  update(dt: number, player: Combatant): void {
    this.greetCooldown -= dt;
    const d = this.distanceTo(player);
    // Only watch the player while they're roughly in front (the head can't turn all the way round).
    const toP = _v.subVectors(player.pos, this.pos).setY(0);
    const front = toP.lengthSq() > 1e-4 && toP.normalize().dot(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))) > -0.1;
    this.char.lookTarget = d < 10 && front ? player.chest(new THREE.Vector3()) : null;
    const near = d < 5 && front;
    if (near && !this.wasNear && this.greetCooldown <= 0 && this.greetClip) {
      this.char.animator.play(this.greetClip, { fadeIn: 0.3, fadeOut: 0.45 });
      this.greetCooldown = 14;
    }
    this.wasNear = near;
    const g = this.char.group;
    g.position.copy(this.pos);
    g.rotation.set(0, this.yaw, 0);
    this.char.update(dt, {
      groundAt: (x, z) => this.world.groundAt(x, z, this.pos.y + 0.6),
      ik: 1,
      autoGround: true,
      wind: _v.set(1.2, 0, 0.7),
    });
  }
}
