import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
import "./FaceMask.css";
import * as AWS from 'aws-sdk/global';
import mqtt from 'mqtt';
import SigV4Utils from './sigv4-utils'; // helper file

const AWS_IOT_ENDPOINT = 'aevqdnds5bghe-ats.iot.us-east-1.amazonaws.com';
const clientId = 'eoh-processing-unit';
const identityPoolId = 'us-east-1:d54013b4-7216-4e6c-8e2c-da0aa0877382';
const region = 'us-east-1';

AWS.config.region = region;
AWS.config.credentials = new AWS.CognitoIdentityCredentials({
  IdentityPoolId: identityPoolId,
});

const { FaceLandmarker, FilesetResolver } = vision;

const FaceMask = () => {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const sceneRef = useRef(null);
  const modelsRef = useRef({});
  const mqttClientRef = useRef(null);
  const [selectedModel, setSelectedModel] = useState("raccoon_head");

  useEffect(() => {
    let renderer, scene, camera, faceLandmarker;

    // Initialize FaceLandmarker
    const initFaceLandmarker = async () => {
      if (!faceLandmarker) {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          runningMode: "VIDEO",
          numFaces: 1,
        });
      }

    };

    // Initialize Three.js Scene
    const initThree = () => {
      if (!renderer) {
        renderer = new THREE.WebGLRenderer({ alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setClearColor(0x000000, 0);
      }

      if (containerRef.current && containerRef.current.childNodes.length === 0) {
        containerRef.current.appendChild(renderer.domElement);
      }

      if (!scene) {
        scene = new THREE.Scene();
        sceneRef.current = scene;
      }

      if (!camera) {
        camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 100);
        camera.position.z = 2;
      }

      const light = new THREE.AmbientLight(0xffffff, 1.8);
      scene.add(light);
      const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
      directionalLight.position.set(0, 1, 1);
      scene.add(directionalLight);
    };

    // Load models
    const loadModels = () => {
      const loader = new GLTFLoader();

      const models = [
        { name: "raccoon_head", scale: [48, 48, 48], path: "/models/raccoon_head.glb" },
        { name: "glasses", scale: [80, 80, 80], path: "/models/glasses.glb" },
        { name: "cat", scale: [15, 15, 15], path: "/models/cat.glb" },
        { name: "dog", scale: [14, 14, 14], path: "/models/dog.glb" },
        { name: "lion", scale: [15, 15, 15], path: "/models/lion.glb" },
        { name: "cow", scale: [15, 15, 15], path: "/models/cow.glb" },
        { name: "horse", scale: [25, 25, 25], path: "/models/horse.glb" },
        { name: "unicorn", scale: [15, 15, 15], path: "/models/unicorn.glb" },
        { name: "freddy", scale: [25, 25, 25], path: "/models/freddy.glb" },
        { name: "nerd", scale: [25, 25, 25], path: "/models/nerd.glb" }
      ];

      models.forEach((model) => {
        loader.load(
          model.path,
          (gltf) => {
            const gltfModel = gltf.scene;
            gltfModel.scale.set(...model.scale);
            gltfModel.visible = false;
            sceneRef.current.add(gltfModel);
            modelsRef.current[model.name] = gltfModel;
          },
          undefined,
          (error) => console.error(`${model.name} model load error:`, error)
        );
      });
    };

    const applyMatrixToModels = (matrixData) => {
      if (!matrixData || matrixData.length === 0) return;

      const threeMatrix = new THREE.Matrix4();
      threeMatrix.fromArray(matrixData);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      threeMatrix.decompose(position, quaternion, scale);

      // Adjust the position and scale of models
      if (modelsRef.current[selectedModel]) {
        const model = modelsRef.current[selectedModel];
        model.position.copy(position);
        model.quaternion.copy(quaternion);
        model.position.y += 0.05;
        model.position.z += 0.02;
      }
    };

    const processResults = (results) => {
      if (!results || !results.faceLandmarks || !results.faceLandmarks.length) return;

      let landmarks = results.faceLandmarks[0].map((lm) => ({
        x: lm.x,
        y: lm.y,
        z: lm.z,
      }));

      const blendshapes = {};
      for (const category of results.faceBlendshapes[0]?.categories || []) {
        if (category && category.categoryName && category.score !== undefined) {
          blendshapes[category.categoryName] = category.score;
        }
      }

      let matrixData = results.facialTransformationMatrixes[0]?.data;
      applyMatrixToModels(matrixData);

      Object.values(modelsRef.current).forEach((model) => {
        if (model && model === modelsRef.current[selectedModel]) {
          model.visible = true;
          model.traverse((obj) => {
            if (obj.isMesh && obj.morphTargetDictionary && obj.morphTargetInfluences) {
              for (const [name, value] of Object.entries(blendshapes)) {
                const index = obj.morphTargetDictionary[name];
                if (index !== undefined) {
                  obj.morphTargetInfluences[index] = value;
                }
              }
            }
          });
        } else {
          model.visible = false;
        }
      });
    };

    // Track Face function using video input
    const trackFace = async () => {
      try {
        if (videoRef.current && faceLandmarker) {
          try {
            const results = await faceLandmarker.detectForVideo(videoRef.current, performance.now());
            // processResults(results);
            if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
              processResults(results);
            }
          } catch (error) {
            console.log('Error in face tracking:', error);
          }

        }
        requestAnimationFrame(trackFace);
      } catch (error) {
        console.log('Error in face tracking:', error);
      }


    };

    const animate = () => {
      requestAnimationFrame(animate);
      if (sceneRef.current && camera) {
        renderer.render(sceneRef.current, camera);
      }
    };

    const setup = async () => {
      initThree();
      await initFaceLandmarker();
      loadModels();
      animate();

      navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" },
      }).then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onplaying = () => {
            trackFace();
            animate()
          };
        }
      });
    };

    setup();

    return () => {};
  }, [selectedModel]);

  // MQTT Client Setup
  useEffect(() => {
    if (mqttClientRef.current) return;

    AWS.config.credentials.get(() => {
      const { accessKeyId, secretAccessKey, sessionToken } = AWS.config.credentials;

      const url = SigV4Utils.getSignedUrl(
        AWS_IOT_ENDPOINT,
        region,
        accessKeyId,
        secretAccessKey,
        sessionToken
      );

      const client = mqtt.connect(url, { clientId, protocol: 'wss' });
      mqttClientRef.current = client;

      client.on('connect', () => {
        console.log('✅ Connected to AWS IoT');
        client.subscribe('user-requests');
      });

      client.on('message', (topic, message) => {
        console.log(`📩 Message on ${topic}:`, message.toString());

        try {
          const data = JSON.parse(message.toString());
          if (data.requestType === 'feature-change' && data.event?.feature === 'mask') {
            const modelName = data.event.featureParam;

            if (modelsRef.current[modelName]) {
              setSelectedModel(modelName);  // Trigger model change
            } else {
              console.warn(`Model "${modelName}" not loaded yet or invalid model name.`);
            }
          }
        } catch (err) {
          console.error('Error processing MQTT message:', err);
        }
      });

      client.on('error', (err) => {
        console.error('❌ MQTT Error:', err);
      });

      client.on('close', () => {
        console.log('🔌 MQTT connection closed');
      });

      return () => {
        client.end();
      };
    });
  }, []);

  return (
    <>
      <video ref={videoRef} className="video-background" autoPlay muted playsInline></video>
      <div ref={containerRef} className="canvas-container" />
    </>
  );
};

export default FaceMask;
