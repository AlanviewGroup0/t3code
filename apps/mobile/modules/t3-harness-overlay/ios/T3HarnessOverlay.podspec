Pod::Spec.new do |s|
  s.name           = 'T3HarnessOverlay'
  s.version        = '1.0.0'
  s.summary        = 'Back to Editor overlay for T3 Code harness builds.'
  s.description    = 'A native window overlaid on previewed apps that returns to the T3 Code bundle.'
  s.author         = 'T3 Tools'
  s.homepage       = 'https://t3tools.com'
  s.platforms      = {
    :ios => '18.0',
  }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
