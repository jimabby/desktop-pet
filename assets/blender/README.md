# Articulated animal sources

Original stylized toy characters generated in Blender 4.5.7 LTS. The editable
`.blend` files and exported `.glb` files are part of this project. No external
art, textures or model downloads are used. The models follow the project's MIT
license. Three.js's license is included in `src/renderer/THREE-LICENSE.txt`.

Blender is installed at `~/Applications/Blender.app` on this development machine.
The installer came from [Blender's official 4.5 release directory](https://download.blender.org/release/Blender4.5/).
Its SHA-256 matched the official checksum and its macOS code signature verified.

To regenerate both files (overwrites the generated models and Blender sources):

```sh
"$HOME/Applications/Blender.app/Contents/MacOS/Blender" \
  --background --factory-startup --python scripts/create-animals.py
npm run test:3d
```

Open either `.blend` file in Blender. Select `AnimalRig`, use Pose Mode to move
individual joints, or select its animations in the Action Editor. The default
active action is `idle`; all other clips are preserved as actions and muted NLA
tracks. Press play to preview. Mesh names begin with `Mesh_`, while bones have
stable names used by the renderer. Keep those bone names when editing.

The models use rigid weights at joints: each rounded piece follows one bone.
This makes every major part independently movable and editable, with a toy-like
appearance. This is not a continuous organic skin or simulated fur. For more
realistic bending, replace pieces with connected topology and blended weights
while retaining the bone names and clips.

The 18 bones are Root, Torso, Head, Jaw, Eye_L/R, Ear_L/R, Foreleg_L/R,
FrontPaw_L/R, HindLeg_L/R, HindPaw_L/R, Tail and TailTip. The front paws are child
joints of their forelegs, ears and eyes follow the head, and the tail tip follows
the tail base. Animation tests verify that all major body joints actually move.

Export as glTF Binary (`.glb`), include skins and all actions, and place the
files under `src/renderer/models/`. Each model is approximately 1 MB. No Draco
or remote decoder is required. `npm run test:3d` saves screenshots in a temporary
directory and prints its path; it does not touch your live pet configuration.

Gentle `petting`, `sniff`, `paw`, and `groom` clips keep the root planted.
The kitten washes a raised paw; the puppy scratches with a hind paw.
The renderer plays gestures once with a fade back to the current mood.
