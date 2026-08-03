import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, StyleSheet, type TextStyle } from 'react-native';
import { gradients } from '@/constants/gradients';

type Props = {
  text: string;
  style?: TextStyle;
};

export function GradientText({ text, style }: Props) {
  return (
    <MaskedView
      maskElement={
        <Text style={[styles.text, style]}>{text}</Text>
      }
    >
      <LinearGradient
        colors={gradients.interactive}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
      >
        <Text style={[styles.text, style, styles.transparent]}>{text}</Text>
      </LinearGradient>
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  text: {
    fontSize: 16,
  },
  transparent: {
    opacity: 0,
  },
});
