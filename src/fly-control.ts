import * as THREE from 'three';

export class FlyControl extends THREE.EventDispatcher {
    vel = new THREE.Vector3();
    key = new THREE.Vector3();
    speed = .5;
    quat = new THREE.Quaternion();
    locked = false;
    constructor(private cam: THREE.Camera, canvas: HTMLCanvasElement) {
        super();

        document.body.addEventListener('wheel', e => {
            // this.speed *= Math.exp(-e.deltaY * 1e-3);
            this.vel.z += e.deltaY * this.speed * 1e-3;
        });
        document.body.addEventListener('keydown', e => {
            switch (e.key) {
                case 'w':
                    this.key.z = -1 * this.speed;
                    break;
                case 's':
                    this.key.z = 1 * this.speed;
                    break;
                case 'a':
                    this.key.x = -1 * this.speed;
                    break;
                case 'd':
                    this.key.x = 1 * this.speed;
                    break;
                case ' ':
                    document.exitPointerLock();
                    break;
            }
        });
        document.body.addEventListener('keyup', e => {
            switch (e.key) {
                case 'w':
                case 's':
                    this.key.z = 0;
                    break;
                case 'a':
                case 'd':
                    this.key.x = 0;
                    break;
            }
        });

        canvas.addEventListener('click', (e) => {
            if (document.pointerLockElement != null) {
                document.exitPointerLock();
                return;
            }
            if (e.button === 2) {
                document.exitPointerLock();
            } else {
                canvas.requestPointerLock();
            }
        });

        document.body.addEventListener('mousemove', e => {
            if (document.pointerLockElement === canvas) {
                this.cam.rotateOnWorldAxis(this.d.set(0, 1, 0), -e.movementX * 1e-3);
                this.cam.rotateOnAxis(this.d.set(1, 0, 0), -e.movementY * 1e-3);
                // this.dispatchEvent({ type: 'change' });
            }
        });
    }

    private lastTime = performance.now();
    private d = new THREE.Vector3();
    private mat3 = new THREE.Matrix3();
    update() {
        const dt = performance.now() - this.lastTime;
        this.vel.add(this.key);
        if (this.vel.dot(this.vel) > 1e-4) {
            const { cam, d, mat3 } = this;
            mat3.getNormalMatrix(cam.matrixWorld);
            d.copy(this.vel).applyMatrix3(mat3).multiplyScalar(dt * 1e-3);
            cam.position.add(d);
            // this.dispatchEvent({ type: 'change' });
        }
        this.vel.multiplyScalar(.85);
        this.lastTime = performance.now();
    }
}