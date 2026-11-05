// Pick or take a square profile photo, returned as a data: URI so it can be
// saved with the account and shown anywhere without file-system access.
import * as ImagePicker from 'expo-image-picker';

export type PhotoSource = 'library' | 'camera';

export async function pickPhoto(source: PhotoSource): Promise<{ uri: string } | { error: string } | null> {
  try {
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.35, base64: true };
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { error: 'Camera access is off. You can turn it on in Settings.' };
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }
    if (result.canceled || !result.assets?.length) return null;
    const a = result.assets[0];
    if (a.base64) return { uri: `data:${a.mimeType ?? 'image/jpeg'};base64,${a.base64}` };
    return { uri: a.uri };
  } catch {
    return { error: "That photo couldn't be opened. Try another one." };
  }
}
