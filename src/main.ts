/// <reference types="@webgpu/types" />
import * as THREE from 'three'
import main_shader from './shaders/main.wgsl';
import { Renderer } from './renderer';
import { FlyControl } from './fly-control';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { buildCluster, vertexRemap } from './cluster';

const createBuffer = (device: GPUDevice, data: THREE.TypedArray, usage = GPUBufferUsage.VERTEX) => {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: usage | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
}

(async () => {
    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 500);
    camera.position.z = 4;
    camera.updateWorldMatrix(false, true);

    console.log('Hello, World!');
    const canvas = document.querySelector('#screen') as HTMLCanvasElement;
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    console.log(canvas.width, canvas.height);

    const fly = new FlyControl(camera, canvas);

    const renderer = await new Renderer(canvas).init();
    window['renderer'] = renderer;
    const { context, device, presentationFormat } = renderer;


    // const loader = new GLTFLoader();
    // const gltf = await loader
    //     .loadAsync('/res2/Suzanne/Suzanne.gltf');
        // .loadAsync('/res/DamagedHelmet.glb');
        // .loadAsync('/res/Sponza/Sponza.gltf');
        // .loadAsync('/res2/FlightHelmet/gltf/FlightHelmet.gltf');
        // .loadAsync('/res2/stylized_little_japanese_town_street/scene.gltf');
        // .loadAsync('/res2/sylvanas_3d_windrunner_wow/scene.gltf');
    // const gltf2 = await loader
    //     .loadAsync('/res2/Suzanne/Suzanne.gltf');
        // .loadAsync('/res/DamagedHelmet.glb');
        // .loadAsync('/res/Sponza/Sponza.gltf');
        // .loadAsync('/res2/FlightHelmet/gltf/FlightHelmet.gltf');

    const gltf = {scene: await new OBJLoader().loadAsync('/res/bunny.obj')};

    // const sphere = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.4, 64 * 6, 8 * 6), new THREE.MeshBasicMaterial());
    // const gltf = {scene: new THREE.Group().add(sphere)};

    // gltf.scene.scale.setScalar(.01);
    gltf.scene.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
            // obj.geometry.scale(.01, .01, .01);
            if (!(obj.material instanceof THREE.MeshBasicMaterial)) {
                obj.material = new THREE.MeshBasicMaterial();
            }
            if (obj.geometry.index == null) {
                console.log('drawArrays, generate index buffer, face count: ', obj.geometry.attributes.position.array.length / 3);
                const index = new Uint32Array(obj.geometry.attributes.position.array.length / 3);
                for (let i = 0; i < index.length; i++) {
                    index[i] = i;
                }
                obj.geometry.setIndex(new THREE.BufferAttribute(index, 1));
            }
        }
    });


    const scene = new THREE.Scene();
    new THREE.Box3().setFromObject(gltf.scene).getCenter(gltf.scene.position).multiplyScalar(-1);
    // scene.add(gltf.scene, gltf2.scene);
    scene.add(gltf.scene);
    // scene.add(new THREE.Mesh(new THREE.BoxGeometry().translate(1, 0, 0), new THREE.MeshBasicMaterial()));
    // scene.add(new THREE.Mesh(new THREE.BoxGeometry().translate(-1, 0, 0), new THREE.MeshBasicMaterial()));
    // const sphere = new THREE.Mesh(new THREE.TorusKnotGeometry(), new THREE.MeshBasicMaterial());
    // scene.updateMatrixWorld();
    // gltf.scene.scale.setScalar(.01);
    scene.updateWorldMatrix(true, true);
    scene.updateMatrixWorld();

    // const bound = new THREE.Box3().setFromObject(gltf.scene);
    // const size = bound.getSize(new THREE.Vector3());
    // const center = bound.getCenter(new THREE.Vector3());
    // const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());

    // box.geometry.scale(size.x, size.y, size.z);
    // box.geometry.translate(center.x, center.y, center.z);
    // scene.add(box);

    gltf.scene.traverse(obj => obj.visible = false);


    // scene.add(sphere);
    {

        // gether all triangles
        const global_result = (() => {
            let vertices_length = 0;
            let indices_length = 0;
            let vertices: Float32Array[] = [];
            let indices: ArrayLike<number>[] = [];
            const pending: THREE.Object3D[] = [];
            scene.traverse(obj => {
                pending.push(obj);
                obj.updateMatrixWorld();
                if (obj instanceof THREE.Mesh) {
                    obj.geometry.attributes.position.applyMatrix4(obj.matrixWorld);
                    const position = obj.geometry.attributes?.position?.array as Float32Array;
                    let index = obj.geometry.index?.array as Uint32Array;
                    if (index == null) {
                        index = new Uint32Array(position.length / 3);
                        for (let i = 0; i < index.length; i++) {
                            index[i] = i;
                        }
                    }
                    vertices_length += position.length;
                    indices_length += index.length ?? 0;

                    vertices.push(position);
                    indices.push(index);
                }
            });

            pending.forEach(obj => {
                obj.matrix.identity();
                obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
            });

            const position = new Float32Array(vertices_length);
            const index = new Uint32Array(indices_length);
            vertices_length = indices_length = 0;
            vertices.forEach(vert => {
                for (let i = 0; i < vert.length; i++) {
                    position[vertices_length++] = vert[i];
                }
            });
            indices.forEach(idx => {
                for (let i = 0; i < idx.length; i++) {
                    index[indices_length++] = idx[i];
                }
            });

            gltf.scene.updateWorldMatrix(true, true);

            return {
                position,
                index,
            };
        })();

        const { position, index } = global_result;

        vertexRemap(index, position, 4 * 3);

        // const model = gltf.scene.children[0] as THREE.Mesh;
        // // const model = gltf.scene.children[0] as THREE.Mesh;
        // const geometry = model.geometry as THREE.BufferGeometry;
        // const position = geometry.attributes.position.array as Float32Array;
        // let index = geometry?.index?.array as Uint16Array;
        // if (index == null){
        //     index = new Uint16Array(position.length / 3);
        //     for (let i = 0; i < index.length; i++) {
        //         index[i] = i;
        //     }
        // }
        debugger
        const { adjacency, triangles, nodes, kd_indices, clusters, cluster_vertices, cluster_triangles, cluster_cones } = buildCluster(position, index);
        // const normalMatrix = new THREE.Matrix3().getNormalMatrix(model.matrixWorld);
        debugger
        const cones = cluster_cones.map((face) => {
            const area = face.area * 2 + 0.0;
            const height = area * 2;
            const cone = new THREE.Mesh(new THREE.ConeGeometry(area, height, 6, 1).translate(0, height * .5, 0).rotateX(Math.PI * .5), new THREE.MeshBasicMaterial());
            // cone.position.fromArray(face.pos).applyMatrix4(model.matrixWorld);
            cone.position.fromArray(face.pos);
            cone.position.x += 3;
            // cone.lookAt(new THREE.Vector3(face.nx, face.ny, face.nz).applyMatrix3(normalMatrix).add(cone.position));
            cone.lookAt(new THREE.Vector3(face.nx, face.ny, face.nz).add(cone.position));
            // cone.applyMatrix4(model.matrixWorld);
            return cone;
        });
        scene.add(...cones);

        const rootBounds = new THREE.Box3().setFromObject(gltf.scene);

        const box = new THREE.Box3();
        const tempV3 = new THREE.Vector3();
        const box_mesh: THREE.Mesh[] = [];
        const box_geo = new THREE.BoxGeometry();

        // clusters
        clusters.forEach((cluster, id) => {
            // const position = new THREE.BufferAttribute()
            const cluster_vert = cluster_vertices.slice(cluster.vertex_offset, cluster.vertex_offset + cluster.vertex_count);
            const cluster_tri = new Uint32Array(cluster_triangles.slice(cluster.triangle_offset, cluster.triangle_offset + cluster.triangle_count * 3));
            const pos = new Float32Array(cluster_vert.length * 3);
            for (let i = 0; i < cluster.vertex_count; i++) {
                const v_offset = cluster_vert[i] * 3;
                const i3 = i * 3;
                pos[i3] = position[v_offset];
                pos[i3 + 1] = position[v_offset + 1];
                pos[i3 + 2] = position[v_offset + 2];
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setIndex(new THREE.BufferAttribute(cluster_tri, 1));
            // geo.applyMatrix4(model.matrixWorld);
            const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
            mesh.visible = false;
            scene.add(mesh);
            // mesh.position.y = id * 2;

            new Promise<THREE.Mesh>((res, rej) => {
                setTimeout(() => {
                    res(mesh);
                }, id * 10);
            }).then(obj => {
                obj.visible = true
                // console.log('visible, ', id);
                // obj.onBeforeRender = () => {
                //     obj.position.x = Math.sin(performance.now() * 0.0005 + id) * 1;
                //     // obj.updateMatrix();
                // }
            });

        });

        // gltf.scene.position.y = 1;


        // kd-tree visualization
        (() => {
            const tasks = [{offset: 0, depth: 0, bound: rootBounds}];

            while (tasks.length > 0) {
                const { offset, depth, bound } = tasks.pop();
                const node = nodes[offset];
                if (node.axis !== 3 && isNaN(node.index)) {
                    const mesh = new THREE.Mesh(box_geo, new THREE.MeshBasicMaterial());
                    bound.getCenter(mesh.position);
                    bound.getSize(mesh.scale);
                    const leftBound = bound.clone();
                    const rightBound = bound.clone();
                    switch(node.axis) {
                        case 0:
                            mesh.position.x = node.split;
                            mesh.scale.x = 0.01;
                            leftBound.max.x = node.split;
                            rightBound.min.x = node.split;
                            break;
                        case 1:
                            mesh.position.y = node.split;
                            mesh.scale.y = 0.01;
                            leftBound.max.y = node.split;
                            rightBound.min.y = node.split;
                            break;
                        case 2:
                            mesh.position.z = node.split;
                            mesh.scale.z = 0.01;
                            leftBound.max.z = node.split;
                            rightBound.min.z = node.split;
                            break;
                    }
                    // mesh.applyMatrix4(model.matrixWorld); // TODO:
                    mesh.position.x -= 5;
                    mesh.updateMatrix();
                    box_mesh.push(mesh);
                    tasks.push({
                        offset: offset + 1,
                        depth: depth + 1,
                        bound: leftBound,
                    });
                    tasks.push({
                        offset: offset + node.children + 1,
                        depth: depth + 1,
                        bound: rightBound,
                    })

                    mesh.visible = false;
                    new Promise<THREE.Mesh>((res, rej) => {
                        setTimeout(() => {
                            res(mesh);
                        }, depth * 1000);
                    }).then(obj => {
                        obj.visible = true
                        // console.log('visible, ', depth);
                    });
                }
            }
        // })();
        });

        if (box_mesh.length > 0)
            scene.add(...box_mesh);

    }

    const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
            const canvas = entry.target as HTMLCanvasElement;
            const width = entry.contentBoxSize[0].inlineSize * window.devicePixelRatio;
            const height = entry.contentBoxSize[0].blockSize * window.devicePixelRatio;
            canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
            canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
            console.log('resize', { width, height });
        }
        // render();
    });


    const render = () => {
        renderer.drawScene(scene, camera);
        fly.update();
    }

    observer.observe(canvas);

    (() => {
        let renderLoop = () => {
            render();
            requestAnimationFrame(renderLoop);
        }
        renderLoop();
    })();
})()